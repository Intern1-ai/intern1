#!/bin/sh
# setup-project.sh — dynamically sets up and starts a single project
# Called by auth-server.js after onboarding form submission.
# All inputs passed as environment variables to avoid shell-escaping issues
# with tokens and URLs containing special characters.
#
# Required env vars:
#   PROJ_NAME, PROJ_REPO, PROJ_PORT
# Optional env vars:
#   PROJ_START, PROJ_ENV, PROJ_TOKEN, PROJ_BRANCH, PROJ_IFRAME, GIT_USERNAME

NAME="$PROJ_NAME"
REPO="$PROJ_REPO"
PORT="$PROJ_PORT"
START="${PROJ_START:-npm start}"
ENV_FILE="${PROJ_ENV:-}"
GIT_TOKEN_VAL="${PROJ_TOKEN:-}"
AI_BRANCH="${PROJ_BRANCH:-}"
IS_IFRAME="${PROJ_IFRAME:-false}"
GIT_USERNAME="${GIT_USERNAME:-intern1}"

mkdir -p /tmp/logs
exec >> /tmp/logs/$NAME.log 2>&1

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Setting up project: $NAME"

# Inject git credentials into HTTPS URL if token provided
CLONE_URL="$REPO"
if [ -n "$GIT_TOKEN_VAL" ]; then
  PROTO=$(echo "$REPO" | grep -o 'https\?://')
  REST=$(echo "$REPO" | sed "s|https\?://||")
  CLONE_URL="${PROTO}${GIT_USERNAME}:${GIT_TOKEN_VAL}@${REST}"
fi

echo "Cloning $NAME..."
git clone "$CLONE_URL" "/code/$NAME" || { echo "ERROR: Failed to clone $NAME"; exit 1; }
cd "/code/$NAME"

# Checkout branch and merge from master/main if set
if [ -n "$AI_BRANCH" ] && [ "$AI_BRANCH" != "null" ]; then
  echo "Switching $NAME to branch $AI_BRANCH..."
  git checkout "$AI_BRANCH" 2>/dev/null || git checkout -b "$AI_BRANCH"
  git merge master --no-edit 2>/dev/null || git merge main --no-edit 2>/dev/null || echo "Merge skipped (no master/main)"
fi
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
echo "$NAME is on branch: $CURRENT_BRANCH"

# Register in projects_info.json (remove stale entry first)
node -e "
  const fs = require('fs');
  const arr = JSON.parse(fs.readFileSync('/tmp/projects_info.json', 'utf8'));
  const filtered = arr.filter(p => p.name !== process.argv[1]);
  filtered.push({ name: process.argv[1], branch: process.argv[2], port: parseInt(process.argv[3]), iframe: process.argv[4] === 'true' });
  fs.writeFileSync('/tmp/projects_info.json', JSON.stringify(filtered));
" "$NAME" "$CURRENT_BRANCH" "$PORT" "$IS_IFRAME"

# Copy env file if provided
if [ -n "$ENV_FILE" ] && [ -f "/config/envs/$ENV_FILE" ]; then
  cp "/config/envs/$ENV_FILE" "/code/$NAME/.env"
fi

echo "Installing dependencies for $NAME..."
npm install

# Auto-detect Vite and override start command
if jq -e '.devDependencies.vite or .dependencies.vite' package.json > /dev/null 2>&1; then
  echo "Detected Vite project"
  START="npx vite --port $PORT --host 0.0.0.0 --base=/code/$NAME/"
fi

echo "Starting $NAME on port $PORT..."
PORT=$PORT PUBLIC_URL="/code/$NAME/" $START &

# Iframe projects: no trailing slash (Vite needs full path forwarded).
# Non-iframe projects: trailing slash strips /code/$NAME/ prefix so the
# backend receives clean paths (e.g. /login not /code/nps/login).
if [ "$IS_IFRAME" = "true" ]; then
  PROXY_PASS="http://localhost:$PORT"
else
  PROXY_PASS="http://localhost:$PORT/"
fi

# Add nginx proxy block for this project
cat >> /tmp/nginx_projects.conf << EOF
location ^~ /code/$NAME/ {
    proxy_pass $PROXY_PASS;
    proxy_http_version 1.1;
    proxy_set_header Host "localhost:$PORT";
    proxy_set_header Accept-Encoding "";
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_hide_header Content-Security-Policy;
    proxy_hide_header X-Frame-Options;
    sub_filter '</head>' '<script>history.replaceState({},document.title,"/")</script></head>';
    sub_filter_once on;
}
EOF
nginx -c /app/nginx.conf -s reload

# Update config.json with the new projects list
node -e "
  const fs = require('fs');
  const projects = JSON.parse(fs.readFileSync('/tmp/projects_info.json', 'utf8'));
  const cfg = fs.existsSync('/app/dist/config.json')
    ? JSON.parse(fs.readFileSync('/app/dist/config.json', 'utf8'))
    : { yepUrl: '/yep/', rightUrl: '', tunnelUrl: '' };
  cfg.projects = projects;
  fs.writeFileSync('/app/dist/config.json', JSON.stringify(cfg));
"

# Patch any .mcp.json Playwright config to include Docker sandbox flags
if [ -f "/code/$NAME/.mcp.json" ]; then
  node -e "
    const fs = require('fs');
    const f = '/code/$NAME/.mcp.json';
    try {
      const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
      const pw = cfg.mcpServers && cfg.mcpServers.playwright;
      if (pw) {
        pw.command = 'playwright-mcp';
        pw.args = ['--no-sandbox'];
        fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
        console.log('Patched .mcp.json Playwright config for Docker');
      }
    } catch {}
  "
fi

# Register with YepAnywhere and start a session
PROJECT_ID=$(echo -n "/code/$NAME" | base64 -w0 | tr -d '=')
node -e "
  const http = require('http');
  const headers = {
    'Content-Type': 'application/json',
    'Origin': 'http://localhost:3400',
    'Referer': 'http://localhost:3400/',
    'X-Yep-Anywhere': 'true'
  };

  function post(path, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request({ hostname:'localhost', port:3400, path, method:'POST', headers:{...headers,'Content-Length':Buffer.byteLength(data)} }, res => {
        let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d));
      });
      req.on('error', reject);
      req.write(data); req.end();
    });
  }

  post('/api/projects', { path: '/code/$NAME' })
    .then(d => { console.log('Registered $NAME with YepAnywhere:', d); })
    .then(() => post('/api/projects/$PROJECT_ID/sessions', { message: 'You are working on the $NAME project at /code/$NAME. Use the CLAUDE.md file for context.' }))
    .then(d => { console.log('Started session for $NAME:', d); })
    .catch(e => console.error('YepAnywhere setup error:', e.message));
"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Setup complete for $NAME"
