#!/bin/sh

# Wait for a port to accept connections (uses node since it's always available)
wait_for_port() {
  PORT=$1
  NAME=$2
  TIMEOUT=${3:-60}
  echo "Waiting for $NAME on port $PORT..."
  for i in $(seq 1 "$TIMEOUT"); do
    node -e "
      const net = require('net');
      const c = net.createConnection($PORT, '127.0.0.1');
      c.on('connect', () => { c.destroy(); process.exit(0); });
      c.on('error', () => process.exit(1));
    " 2>/dev/null && return 0
    sleep 1
  done
  echo "Warning: $NAME did not respond on port $PORT within ${TIMEOUT}s"
  return 1
}

# Wait for a project port in the background, then flip rightUrl in config.json.
# This keeps the loading panel visible until the app is actually ready.
update_right_when_ready() {
  NAME="$1"
  PORT="$2"
  TUNNEL_URL="$3"
  wait_for_port "$PORT" "$NAME" 300
  # Only set rightUrl if no iframe project is active yet; always refresh project list
  CURRENT_RIGHT=$(node -e "
    const fs = require('fs');
    try { const c = JSON.parse(fs.readFileSync('/app/dist/config.json', 'utf8')); process.stdout.write(c.rightUrl || ''); } catch(e) {}
  ")
  if [ -z "$CURRENT_RIGHT" ]; then
    write_config "/yep/" "/code/$NAME/" "$TUNNEL_URL"
    echo "$NAME is ready — right iframe updated"
  else
    write_config "/yep/" "$CURRENT_RIGHT" "$TUNNEL_URL"
    echo "$NAME is ready (right iframe already showing $CURRENT_RIGHT)"
  fi
}

register_projects_with_yepanywhere() {
  if [ ! -f /config/projects.json ]; then return; fi
  echo "Registering projects with YepAnywhere..."
  PROJECT_COUNT=$(jq length /config/projects.json)
  for i in $(seq 0 $((PROJECT_COUNT - 1))); do
    NAME=$(jq -r ".[$i].name" /config/projects.json)
    PROJECT_PATH="/code/$NAME"
    node -e "
      const http = require('http');
      const data = JSON.stringify({ path: '$PROJECT_PATH' });
      const req = http.request({
        hostname: 'localhost', port: 3400, path: '/api/projects',
        method: 'POST', headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          'Origin': 'http://localhost:3400',
          'Referer': 'http://localhost:3400/',
          'X-Yep-Anywhere': 'true'
        }
      }, res => console.log('Registered $NAME (status ' + res.statusCode + ')'));
      req.on('error', e => console.error('Failed to register $NAME:', e.message));
      req.write(data);
      req.end();
    "
  done
}

print_online_banner() {
  TUNNEL="$1"
  echo ""
  echo "=================================================="
  echo "  INTERN1 IS ONLINE"
  echo "  Local:  http://localhost:3500"
  if [ -n "$TUNNEL" ]; then
  echo "  Tunnel: $TUNNEL"
  fi
  echo "=================================================="
  echo ""
}

write_config() {
  YEP_URL="$1" RIGHT_URL="$2" TUNNEL_URL_VAL="$3" node -e "
    const fs = require('fs');
    const projects = fs.existsSync('/tmp/projects_info.json')
      ? JSON.parse(fs.readFileSync('/tmp/projects_info.json', 'utf8'))
      : [];
    process.stdout.write(JSON.stringify({
      yepUrl: process.env.YEP_URL,
      rightUrl: process.env.RIGHT_URL,
      tunnelUrl: process.env.TUNNEL_URL_VAL,
      projects
    }));
  " > /app/dist/config.json
}


# Configure git identity
GIT_USERNAME="intern1"
git config --global user.name "$GIT_USERNAME"
git config --global user.email "${GIT_EMAIL:-${GIT_USERNAME}@intern1.local}"

# ── 1. CORE SERVICES ──────────────────────────────────────────────
echo "Starting core services..."
touch /tmp/nginx_projects.conf
echo "[]" > /tmp/projects_info.json
# Configure YepAnywhere: skip onboarding and enable bypass permissions
mkdir -p "$HOME/.yep-anywhere"
printf '{"complete":true,"completedAt":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$HOME/.yep-anywhere/onboarding.json"

# Enable bypass permissions by default
cat > "$HOME/.yep-anywhere/settings.json" << 'EOF'
{
  "bypassPermissions": true,
  "theme": "dark",
  "autoSave": true
}
EOF
echo "YepAnywhere configured with bypass permissions enabled"
if [ -n "$ANTHROPIC_API_KEY" ]; then
  yepanywhere --host 0.0.0.0 &
else
  echo "No ANTHROPIC_API_KEY set — YepAnywhere will start after onboarding"
fi
nginx -c /app/nginx.conf &
node /app/auth-server.js &
ttyd -p 3700 bash &
if [ -n "$ANTHROPIC_API_KEY" ]; then
  wait_for_port 3400 yepanywhere
fi
wait_for_port 3600 "auth server"


# ── 3. TUNNELS ────────────────────────────────────────────────────
FINAL_TUNNEL_URL=""

if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
  FINAL_TUNNEL_URL=${TUNNEL_URL:-}
  write_config "/yep/" "" "$FINAL_TUNNEL_URL"
  sudo cloudflared service install "$CLOUDFLARE_TUNNEL_TOKEN" || cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" &

elif [ -n "$USE_QUICK_TUNNEL" ]; then
  cloudflared tunnel --no-autoupdate --url http://localhost:3500 > /tmp/tunnel.log 2>&1 &
  echo "Waiting for tunnel URL..."
  for i in $(seq 1 30); do
    FINAL_TUNNEL_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' /tmp/tunnel.log 2>/dev/null | head -1)
    [ -n "$FINAL_TUNNEL_URL" ] && echo "Tunnel: $FINAL_TUNNEL_URL" && break
    sleep 1
  done
  write_config "/yep/" "" "${FINAL_TUNNEL_URL:-}"

else
  write_config "/yep/" "" ""
fi

print_online_banner "$FINAL_TUNNEL_URL"

# ── 4. PROJECTS ───────────────────────────────────────────────────
RIGHT_URL=""

if [ -f /config/projects.json ]; then
  echo "Loading projects..."
  PROJECT_COUNT=$(jq length /config/projects.json)
  PROJECT_STARTED=0

  # Validate: no duplicate ports
  DUPLICATE_PORT=$(jq -r '[.[].port] | group_by(.) | map(select(length > 1)) | .[0][0] // empty' /config/projects.json)
  if [ -n "$DUPLICATE_PORT" ]; then
    DUPES=$(jq -r "[.[] | select(.port == $DUPLICATE_PORT) | .name] | join(\", \")" /config/projects.json)
    echo ""
    echo "ERROR: Multiple projects configured on port $DUPLICATE_PORT: $DUPES"
    echo "Each project must have a unique port. Fix config/projects.json and restart."
    echo ""
    exit 1
  fi

  for i in $(seq 0 $((PROJECT_COUNT - 1))); do
    NAME=$(jq -r ".[$i].name" /config/projects.json)
    REPO=$(jq -r ".[$i].repo" /config/projects.json)
    PORT=$(jq -r ".[$i].port" /config/projects.json)
    START=$(jq -r ".[$i].start // \"npm start\"" /config/projects.json)
    ENV_FILE=$(jq -r ".[$i].env // \"\"" /config/projects.json)
    IS_IFRAME=$(jq -r ".[$i].iframe // false" /config/projects.json)
    GIT_TOKEN_VAL=$(jq -r ".[$i].git_token // \"\"" /config/projects.json)

    # Inject credentials into HTTPS URL if git_token is set on the project
    CLONE_URL="$REPO"
    if [ -n "$GIT_TOKEN_VAL" ]; then
      PROTO=$(echo "$REPO" | grep -o 'https\?://')
      REST=$(echo "$REPO" | sed "s|https\?://||")
      CLONE_URL="${PROTO}${GIT_USERNAME:-oauth2}:${GIT_TOKEN_VAL}@${REST}"
    fi

    echo "Cloning $NAME..."
    git clone "$CLONE_URL" "/code/$NAME" || { echo "Failed to clone $NAME, skipping."; continue; }

    cd "/code/$NAME"

    # Checkout ai_branch_name and merge from master/main if set
    AI_BRANCH=$(jq -r ".[$i].ai_branch_name // \"\"" /config/projects.json)
    if [ -n "$AI_BRANCH" ] && [ "$AI_BRANCH" != "null" ]; then
      echo "Switching $NAME to branch $AI_BRANCH..."
      git checkout "$AI_BRANCH" 2>/dev/null || git checkout -b "$AI_BRANCH"
      git merge master --no-edit 2>/dev/null || git merge main --no-edit 2>/dev/null || echo "Merge skipped (no master/main)"
    fi
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    echo "$NAME is on branch: $CURRENT_BRANCH"
    node -e "
      const fs = require('fs');
      const arr = JSON.parse(fs.readFileSync('/tmp/projects_info.json', 'utf8'));
      arr.push({ name: process.argv[1], branch: process.argv[2], port: parseInt(process.argv[3]), iframe: process.argv[4] === 'true' });
      fs.writeFileSync('/tmp/projects_info.json', JSON.stringify(arr));
    " "$NAME" "$CURRENT_BRANCH" "$PORT" "$IS_IFRAME"

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
        .then(d => { console.log('Registered $NAME with YepAnywhere'); })
        .then(() => post('/api/projects/$PROJECT_ID/sessions', { message: 'You are working on the $NAME project at /code/$NAME. Use the CLAUDE.md file for context.' }))
        .then(d => { console.log('Started session for $NAME:', d); })
        .catch(e => console.error('YepAnywhere setup error:', e.message));
    "

    if [ -n "$ENV_FILE" ] && [ -f "/config/envs/$ENV_FILE" ]; then
      cp "/config/envs/$ENV_FILE" "/code/$NAME/.env"
    fi

    echo "Installing $NAME..."
    npm install

    if jq -e '.devDependencies.vite or .dependencies.vite' package.json > /dev/null 2>&1; then
      echo "Detected Vite project"
      # --base ensures Vite generates assets at /code/$NAME/... so nginx subpath proxy works.
      # No allowedHosts patch needed — nginx rewrites Host to localhost:$PORT before forwarding.
      START="npx vite --port $PORT --host 0.0.0.0 --base=/code/$NAME/"
    fi

    echo "Starting $NAME on port $PORT..."
    mkdir -p /tmp/logs
    PORT=$PORT PUBLIC_URL="/code/$NAME/" $START >> /tmp/logs/$NAME.log 2>&1 &

    # Iframe projects (Vite with --base=/code/$NAME/): no trailing slash so nginx
    # forwards the full path and Vite receives the subpath it was built for.
    # Non-iframe projects (APIs): trailing slash strips /code/$NAME/ prefix so
    # the backend receives clean paths (e.g. /login not /code/nps/login).
    if [ "$IS_IFRAME" = "true" ]; then
      PROXY_PASS="http://localhost:$PORT"
    else
      PROXY_PASS="http://localhost:$PORT/"
    fi
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
    # Reload nginx immediately so this project's proxy is active
    nginx -c /app/nginx.conf -s reload

    if [ "$IS_IFRAME" = "true" ]; then
      # Update config.json in the background once the port is ready.
      # This keeps the loading panel visible instead of showing a 502.
      update_right_when_ready "$NAME" "$PORT" "$FINAL_TUNNEL_URL" &
    fi

    cd /workspace
    PROJECT_STARTED=$((PROJECT_STARTED + 1))
  done

  # Update CLAUDE.md with live project information
  echo "Injecting project context into CLAUDE.md..."
  node -e "
    const fs = require('fs');
    const projects = JSON.parse(fs.readFileSync('/tmp/projects_info.json', 'utf8'));

    let claudeMd = fs.readFileSync('/home/node/.claude/CLAUDE.md', 'utf8');

    // Remove old project section if it exists
    claudeMd = claudeMd.replace(/\n## RUNNING PROJECTS[\s\S]*?(?=\n## |$)/g, '');

    // Build new project section
    let projectSection = '\n\n## RUNNING PROJECTS\n\n';
    projectSection += 'The following projects are currently running and accessible:\n\n';

    projects.forEach(p => {
      projectSection += \`### \${p.name}\n\`;
      projectSection += \`- **Local URL**: http://localhost:3500/code/\${p.name}/\n\`;
      projectSection += \`- **Git Branch**: \${p.branch}\n\`;
      projectSection += \`- **Port**: \${p.port}\n\`;
      projectSection += \`- **Code Location**: /code/\${p.name}/\n\`;
      if (p.iframe) {
        projectSection += \`- **Preview**: Viewable in right iframe panel\n\`;
      }
      projectSection += \`\n**To test this project with Playwright MCP**:\n\`;
      projectSection += \`\\\`\\\`\\\`\n\`;
      projectSection += \`playwright_navigate({url: 'http://localhost:3500/code/\${p.name}/'});\n\`;
      projectSection += \`playwright_screenshot({});\n\`;
      projectSection += \`\\\`\\\`\\\`\n\n\`;
    });

    // Append to end of CLAUDE.md
    claudeMd = claudeMd.trimEnd() + projectSection;

    fs.writeFileSync('/home/node/.claude/CLAUDE.md', claudeMd);
  "
fi

tail -f /dev/null
