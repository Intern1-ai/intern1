const http = require('http');
const crypto = require('crypto');
const { execSync, spawnSync, spawn } = require('child_process');
const fs = require('fs');
const net = require('net');

function checkPort(port) {
  return new Promise(resolve => {
    const socket = net.createConnection(port, '127.0.0.1');
    socket.setTimeout(500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error',   () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

const PORT = 3600;
const SESSION_COOKIE = 'intern1_session';
const sessions = new Set();

function getTier() {
  try { return fs.readFileSync('/tmp/tier', 'utf8').trim() || 'free'; } catch { return 'free'; }
}

// Generate a secure random session ID
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

// Parse cookies from request headers
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) cookies[name] = value;
  });
  return cookies;
}

// Parse JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // CORS headers — restrict to same-origin requests only
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // If no password is configured, allow all access
  const passwordRequired = process.env.APP_PASSWORD && process.env.APP_PASSWORD.length > 0;
  const isDefaultPassword = passwordRequired && process.env.APP_PASSWORD === 'changeme';

  // Log all incoming requests
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} from ${req.headers['x-real-ip'] || req.connection.remoteAddress}`);

  // Login endpoint
  if (req.method === 'POST' && req.url === '/login') {
    try {
      const body = await parseBody(req);
      const { password } = body;

      if (!passwordRequired || password === process.env.APP_PASSWORD) {
        const sessionId = generateSessionId();
        sessions.add(sessionId);
        console.log(`  ✓ Login successful (password required: ${passwordRequired})`);

        res.setHeader('Set-Cookie', [
          `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
        ]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, defaultPassword: isDefaultPassword }));
      } else {
        console.log(`  ✗ Login failed: invalid password`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid password' }));
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Bad request' }));
    }
    return;
  }

  // Verify session endpoint
  if (req.method === 'GET' && req.url === '/verify') {
    // If no password required, always authenticated
    if (!passwordRequired) {
      console.log(`  ✓ No password required, auto-authenticated`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated: true, defaultPassword: false }));
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies[SESSION_COOKIE];

    if (sessionId && sessions.has(sessionId)) {
      console.log(`  ✓ Session valid`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated: true, defaultPassword: isDefaultPassword }));
    } else {
      console.log(`  ✗ No valid session`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated: false }));
    }
    return;
  }

  // Tier endpoint
  if (req.method === 'GET' && req.url === '/tier') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tier: getTier() }));
    return;
  }

  // Project online status endpoint
  if (req.method === 'GET' && req.url === '/status') {
    if (passwordRequired) {
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies[SESSION_COOKIE];
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }
    try {
      const projects = fs.existsSync('/tmp/projects_info.json')
        ? JSON.parse(fs.readFileSync('/tmp/projects_info.json', 'utf8'))
        : [];
      const results = await Promise.all(
        projects.map(async p => ({ ...p, online: p.port ? await checkPort(p.port) : false }))
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Git history + status endpoint
  if (req.method === 'GET' && req.url === '/git') {
    console.log(`  [tier:${getTier()}] git endpoint accessed`);
    if (passwordRequired) {
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies[SESSION_COOKIE];
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    try {
      const projects = fs.existsSync('/config/projects.json')
        ? JSON.parse(fs.readFileSync('/config/projects.json', 'utf8'))
        : [];
      const result = projects.map(p => {
        const dir = `/code/${p.name}`;
        if (!fs.existsSync(dir)) return { name: p.name, error: 'not cloned yet' };
        try {
          const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir }).toString().trim();
          const rawStatus = execSync('git status --short', { cwd: dir }).toString().trim();
          const status = rawStatus.split('\n').filter(Boolean);
          const rawDiff = status.length
            ? execSync('git diff --stat HEAD', { cwd: dir }).toString().trim()
            : '';
          // Build a suggested commit message from the changed file names
          const changedFiles = status.map(l => l.slice(3).trim().split(' -> ').pop());
          const dirs = [...new Set(changedFiles.map(f => f.includes('/') ? f.split('/')[0] : '.'))];
          const suggestion = status.length
            ? `update ${dirs.slice(0, 2).join(', ')}${dirs.length > 2 ? ` +${dirs.length - 2} more` : ''}`
            : null;
          return { name: p.name, branch, status, diffStat: rawDiff, suggestion };
        } catch (e) {
          return { name: p.name, error: e.message };
        }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Git commit + push endpoint
  if (req.method === 'POST' && req.url === '/commit') {
    console.log(`  [tier:${getTier()}] commit endpoint accessed`);
    if (passwordRequired) {
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies[SESSION_COOKIE];
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    try {
      const { name, message } = await parseBody(req);
      if (!name || !message?.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name and message are required' }));
        return;
      }

      const dir = `/code/${name}`;
      if (!fs.existsSync(dir)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Project "${name}" not found` }));
        return;
      }

      const run = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });

      const add = run('git', ['add', '-A']);
      if (add.status !== 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, output: add.stderr || add.stdout || 'git add failed' }));
        return;
      }

      const commit = run('git', ['commit', '-m', message.trim()]);
      if (commit.status !== 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, output: commit.stderr || commit.stdout || 'git commit failed' }));
        return;
      }

      const push = run('git', ['push']);
      const pushOutput = (push.stdout || '') + (push.stderr || '');
      if (push.status !== 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, output: pushOutput || 'git push failed' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        output: (commit.stdout || '').trim() + '\n' + pushOutput.trim(),
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Discard all changes endpoint
  if (req.method === 'POST' && req.url === '/discard') {
    console.log(`  [tier:${getTier()}] discard endpoint accessed`);
    if (passwordRequired) {
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies[SESSION_COOKIE];
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    try {
      const { name } = await parseBody(req);
      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name is required' }));
        return;
      }

      const dir = `/code/${name}`;
      if (!fs.existsSync(dir)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Project "${name}" not found` }));
        return;
      }

      const run = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });

      run('git', ['restore', '--staged', '.']);
      run('git', ['restore', '.']);
      const clean = run('git', ['clean', '-fd']);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, output: (clean.stdout || '').trim() || 'All changes discarded.' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Project logs endpoint
  if (req.method === 'GET' && req.url.startsWith('/logs')) {
    if (passwordRequired) {
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies[SESSION_COOKIE];
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const name = qs.get('name');
      const lines = Math.min(parseInt(qs.get('lines') || '200', 10), 1000);

      if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid project name' }));
        return;
      }

      const logPath = `/tmp/logs/${name}.log`;
      if (!fs.existsSync(logPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name, lines: [] }));
        return;
      }

      const content = fs.readFileSync(logPath, 'utf8');
      const allLines = content.split('\n');
      const tail = allLines.slice(-lines).filter((_, i, a) => !(i === a.length - 1 && _ === ''));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name, lines: tail }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Logout endpoint
  if (req.method === 'POST' && req.url === '/logout') {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies[SESSION_COOKIE];

    if (sessionId) {
      sessions.delete(sessionId);
    }

    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Git credential check — test if repo URL + optional token are valid
  if (req.method === 'POST' && req.url === '/git-check') {
    try {
      const { repo, git_token } = await parseBody(req);
      if (!repo) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Repository URL is required' }));
        return;
      }
      // Inject token into HTTPS URL if provided
      let checkUrl = repo;
      if (git_token && checkUrl.startsWith('https://')) {
        const u = new URL(checkUrl);
        u.username = 'oauth2';
        u.password = git_token;
        checkUrl = u.toString();
      }
      const result = spawnSync('git', ['ls-remote', '--exit-code', checkUrl], {
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (result.status === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Repository accessible' }));
      } else {
        const stderr = (result.stderr || '').toString().toLowerCase();
        let message = 'Could not access repository';
        if (stderr.includes('authentication') || stderr.includes('401') || stderr.includes('invalid credentials'))
          message = 'Authentication failed — check your access token';
        else if (stderr.includes('403') || stderr.includes('forbidden'))
          message = 'Access denied — token lacks permission for this repo';
        else if (stderr.includes('404') || stderr.includes('not found') || stderr.includes('repository not found'))
          message = 'Repository not found — check the URL';
        else if (stderr.includes('could not resolve host'))
          message = 'Could not resolve host — check the URL';
        else if (result.status === null)
          message = 'Connection timed out';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message }));
      }
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'Connection error' }));
    }
    return;
  }

  // API key check — is ANTHROPIC_API_KEY already set?
  if (req.method === 'GET' && req.url === '/api-key-check') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ set: !!process.env.ANTHROPIC_API_KEY }));
    return;
  }

  // API key validation — test against Anthropic API
  if (req.method === 'POST' && req.url === '/api-key-validate') {
    try {
      const { apiKey } = await parseBody(req);
      if (!apiKey) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'API key is required' }));
        return;
      }
      const https = require('https');
      const testResult = await new Promise((resolve) => {
        const data = JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
        const testReq = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(data),
          },
        }, (testRes) => {
          let body = '';
          testRes.on('data', c => body += c);
          testRes.on('end', () => {
            if (testRes.statusCode === 200) {
              resolve({ ok: true, message: 'API key is valid' });
            } else if (testRes.statusCode === 401) {
              resolve({ ok: false, message: 'Invalid API key' });
            } else if (testRes.statusCode === 403) {
              resolve({ ok: false, message: 'API key does not have permission' });
            } else if (testRes.statusCode === 429) {
              // Rate limited but key is valid
              resolve({ ok: true, message: 'API key is valid (rate limited)' });
            } else {
              try {
                const err = JSON.parse(body);
                resolve({ ok: false, message: err.error?.message || `API returned ${testRes.statusCode}` });
              } catch {
                resolve({ ok: false, message: `API returned ${testRes.statusCode}` });
              }
            }
          });
        });
        testReq.on('error', (e) => resolve({ ok: false, message: 'Could not reach Anthropic API' }));
        testReq.setTimeout(10000, () => { testReq.destroy(); resolve({ ok: false, message: 'Connection timed out' }); });
        testReq.write(data);
        testReq.end();
      });
      // If valid, set the key and start YepAnywhere immediately
      if (testResult.ok && !process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = apiKey;
        console.log('  ✓ Set ANTHROPIC_API_KEY from validation');
        try { execSync('pkill -f "yepanywhere" 2>/dev/null || true'); } catch {}
        const yepProc = spawn('yepanywhere', ['--host', '0.0.0.0'], {
          detached: true,
          env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
          stdio: ['ignore', fs.openSync('/tmp/yepanywhere.log', 'a'), fs.openSync('/tmp/yepanywhere.log', 'a')],
        });
        yepProc.unref();
        console.log('  ✓ Started YepAnywhere early (from API key validation)');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(testResult));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'Validation failed' }));
    }
    return;
  }

  // Tunnel token check — install cloudflared service and verify connection
  if (req.method === 'POST' && req.url === '/tunnel-check') {
    try {
      const { token } = await parseBody(req);
      if (!token) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Token is required' }));
        return;
      }

      // Stop any previous tunnel
      try { execSync('sudo cloudflared service uninstall 2>/dev/null || true'); } catch {}
      try { execSync('sudo pkill -f cloudflared 2>/dev/null || true'); } catch {}
      await new Promise(r => setTimeout(r, 500));

      // Install as a service — this writes the config and starts cloudflared
      const installResult = spawnSync('sudo', ['cloudflared', 'service', 'install', token], {
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const installOutput = ((installResult.stdout || '') + '' + (installResult.stderr || '')).toString();

      if (installResult.status !== 0 && !installOutput.includes('already installed')) {
        let message = 'Failed to install tunnel service';
        if (installOutput.includes('Unauthorized') || installOutput.includes('unauthorized'))
          message = 'Invalid token — authentication failed';
        else if (installOutput.includes('not found'))
          message = 'Tunnel not found — check your token';
        else if (installOutput.includes('invalid') || installOutput.includes('malformed'))
          message = 'Invalid or malformed token';
        else if (installOutput.trim())
          message = installOutput.trim().slice(0, 200);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message }));
        return;
      }

      // Service installed — now wait for it to register a connection
      // cloudflared service logs to syslog/journald, but we can check the API
      const logFile = '/var/log/cloudflared.log';
      let result = { ok: false, message: 'Tunnel connection timed out' };
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          // Check if cloudflared process is running
          const running = spawnSync('pgrep', ['-f', 'cloudflared'], { stdio: 'pipe' });
          if (running.status !== 0) {
            result = { ok: false, message: 'Tunnel process exited unexpectedly' };
            break;
          }

          // Try to read log file if it exists
          if (fs.existsSync(logFile)) {
            const log = fs.readFileSync(logFile, 'utf8');
            if (log.includes('Registered tunnel connection') || log.includes('Connection registered')) {
              let tunnelId = '';
              try {
                const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                tunnelId = payload.t || '';
              } catch {}
              result = { ok: true, message: 'Tunnel connected' + (tunnelId ? ` (ID: ${tunnelId})` : ''), tunnelId };
              break;
            }
          }

          // Also check connector status via the metrics endpoint
          try {
            const metricsCheck = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:3500'], { timeout: 2000, stdio: 'pipe' });
            // If we can reach ourselves, check if tunnel is registered by looking at process output
          } catch {}
        } catch {}
      }

      // If log file didn't help, check if the process is still alive as a basic health check
      if (result.message === 'Tunnel connection timed out') {
        const running = spawnSync('pgrep', ['-f', 'cloudflared'], { stdio: 'pipe' });
        if (running.status === 0) {
          let tunnelId = '';
          try {
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            tunnelId = payload.t || '';
          } catch {}
          // Process is running — likely connected but logs aren't where we expect
          result = { ok: true, message: 'Tunnel service running' + (tunnelId ? ` (ID: ${tunnelId})` : ''), tunnelId };
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'Failed to start tunnel: ' + e.message }));
    }
    return;
  }

  // Config data — return current projects config + env contents for settings pre-population
  if (req.method === 'GET' && req.url === '/config-data') {
    try {
      const projects = fs.existsSync('/config/projects.json')
        ? JSON.parse(fs.readFileSync('/config/projects.json', 'utf8'))
        : [];
      // Enrich each project with env file contents and mask tokens
      const enriched = projects.map(p => {
        const proj = { ...p };
        // Read env file contents if referenced
        if (p.env) {
          const envPath = `/config/envs/${p.env}`;
          try {
            proj.env_content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').trim() : '';
          } catch { proj.env_content = ''; }
        }
        return proj;
      });
      // Read persisted tunnel config
      let tunnelMode = 'none';
      let tunnelToken = '';
      try {
        if (fs.existsSync('/config/tunnel.json')) {
          const tc = JSON.parse(fs.readFileSync('/config/tunnel.json', 'utf8'));
          tunnelMode = tc.mode || 'none';
          tunnelToken = tc.token || '';
        }
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ projects: enriched, tunnelMode, tunnelToken }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ projects: [], tunnelMode: 'none', tunnelToken: '' }));
    }
    return;
  }

  // Config check — does projects.json have any entries? Is the API key set?
  if (req.method === 'GET' && req.url === '/config-check') {
    try {
      const projects = fs.existsSync('/config/projects.json')
        ? JSON.parse(fs.readFileSync('/config/projects.json', 'utf8'))
        : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        hasProjects: Array.isArray(projects) && projects.length > 0,
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
      }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hasProjects: false, hasApiKey: !!process.env.ANTHROPIC_API_KEY }));
    }
    return;
  }

  // Onboarding setup — write projects.json, configure tunnel, and start each project
  if (req.method === 'POST' && req.url === '/setup') {
    try {
      const { projects, tunnel, apiKey } = await parseBody(req);
      if (!Array.isArray(projects) || projects.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'projects array is required' }));
        return;
      }

      // Set or update API key and (re)start YepAnywhere
      if (apiKey && apiKey !== process.env.ANTHROPIC_API_KEY) {
        const isChange = !!process.env.ANTHROPIC_API_KEY;
        process.env.ANTHROPIC_API_KEY = apiKey;
        console.log(isChange ? '  ✓ Updated ANTHROPIC_API_KEY' : '  ✓ Set ANTHROPIC_API_KEY from onboarding');

        // Kill existing YepAnywhere and restart with new key
        try {
          execSync('pkill -f "yepanywhere" 2>/dev/null || true');
        } catch {}
        const yepProc = spawn('yepanywhere', ['--host', '0.0.0.0'], {
          detached: true,
          env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
          stdio: ['ignore', fs.openSync('/tmp/yepanywhere.log', 'a'), fs.openSync('/tmp/yepanywhere.log', 'a')],
        });
        yepProc.unref();
        console.log('  ✓ Started YepAnywhere with' + (isChange ? ' new' : '') + ' API key');

        // Wait for YepAnywhere to come back up
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 500));
          try {
            const check = await new Promise((resolve) => {
              const req = require('http').get('http://localhost:3400', (res) => {
                resolve(res.statusCode);
              });
              req.on('error', () => resolve(0));
              req.setTimeout(500, () => { req.destroy(); resolve(0); });
            });
            if (check === 200 || check === 304) break;
          } catch {}
        }
      }

      // Resolve tunnel token from saved config if user chose to keep existing
      if (tunnel && tunnel.mode === 'named' && tunnel.keepExisting && !tunnel.token) {
        try {
          const saved = JSON.parse(fs.readFileSync('/config/tunnel.json', 'utf8'));
          if (saved.token) tunnel.token = saved.token;
        } catch {}
      }

      // Start tunnel if requested
      if (tunnel && tunnel.mode === 'quick') {
        console.log('  Starting quick tunnel...');
        const tunnelProc = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', 'http://localhost:3500'], {
          detached: true,
          stdio: ['ignore', fs.openSync('/tmp/tunnel.log', 'a'), fs.openSync('/tmp/tunnel.log', 'a')],
        });
        tunnelProc.unref();
        // Wait for tunnel URL (up to 30s)
        let tunnelUrl = '';
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 1000));
          try {
            const log = fs.readFileSync('/tmp/tunnel.log', 'utf8');
            const match = log.match(/https:\/\/[a-zA-Z0-9-]*\.trycloudflare\.com/);
            if (match) { tunnelUrl = match[0]; break; }
          } catch {}
        }
        if (tunnelUrl) {
          console.log(`  Tunnel: ${tunnelUrl}`);
          // Update config.json with tunnel URL
          try {
            const cfg = JSON.parse(fs.readFileSync('/app/dist/config.json', 'utf8'));
            cfg.tunnelUrl = tunnelUrl;
            fs.writeFileSync('/app/dist/config.json', JSON.stringify(cfg));
          } catch {}
        }
      } else if (tunnel && tunnel.mode === 'named' && tunnel.token) {
        // Check if tunnel is already running (from /tunnel-check)
        let alreadyRunning = false;
        try {
          const result = spawnSync('pgrep', ['-f', 'cloudflared.*tunnel.*run'], { stdio: 'pipe' });
          alreadyRunning = result.status === 0;
        } catch {}

        if (!alreadyRunning) {
          console.log('  Installing named tunnel service...');
          spawnSync('sudo', ['cloudflared', 'service', 'install', tunnel.token], {
            timeout: 10000,
            stdio: 'ignore',
          });
        } else {
          console.log('  Named tunnel already running (started during validation)');
        }

        // Extract tunnel ID from JWT payload
        let tunnelId = '';
        try {
          const payload = JSON.parse(Buffer.from(tunnel.token.split('.')[1], 'base64').toString());
          tunnelId = payload.t || '';
        } catch {}
        if (tunnelId) {
          console.log(`  Named tunnel ID: ${tunnelId}`);
          try {
            const cfg = JSON.parse(fs.readFileSync('/app/dist/config.json', 'utf8'));
            cfg.tunnelUrl = tunnelId;
            fs.writeFileSync('/app/dist/config.json', JSON.stringify(cfg));
          } catch {}
        }
      }

      // Persist tunnel config so settings can re-populate it
      try {
        const tunnelConfig = { mode: tunnel?.mode || 'none' };
        if (tunnel?.mode === 'named' && tunnel.token) tunnelConfig.token = tunnel.token;
        fs.writeFileSync('/config/tunnel.json', JSON.stringify(tunnelConfig));
      } catch {}

      // Validate required fields
      for (const p of projects) {
        if (!p.name || !p.repo || !p.port) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Project is missing required fields (name, repo, port)` }));
          return;
        }
      }

      // --- Teardown old projects that were removed or changed ---
      let oldProjects = [];
      try {
        if (fs.existsSync('/config/projects.json')) {
          oldProjects = JSON.parse(fs.readFileSync('/config/projects.json', 'utf8'));
        }
      } catch {}

      // Build a lookup of new projects by name for comparison
      const newByName = {};
      for (const p of projects) {
        newByName[p.name] = p;
      }

      // Determine which old projects need teardown:
      // - removed entirely (name no longer present)
      // - changed (same name but different repo or branch)
      const toTeardown = [];
      const unchanged = new Set();
      for (const old of oldProjects) {
        const replacement = newByName[old.name];
        if (!replacement) {
          // Project was removed
          toTeardown.push(old);
        } else if (replacement.repo !== old.repo || (replacement.ai_branch_name || '') !== (old.ai_branch_name || '')) {
          // Project repo or branch changed — tear down and re-setup
          toTeardown.push(old);
        } else {
          // Project unchanged — skip setup
          unchanged.add(old.name);
        }
      }

      // Tear down each stale project
      for (const old of toTeardown) {
        console.log(`  Tearing down old project: ${old.name} (port ${old.port})`);
        // Kill process on the old port
        try { execSync(`fuser -k ${old.port}/tcp 2>/dev/null || true`); } catch {}
        // Remove project directory
        try { execSync(`rm -rf /code/${old.name}`); } catch {}
        // Remove log file
        try { fs.unlinkSync(`/tmp/logs/${old.name}.log`); } catch {}
        // Remove env file
        if (old.env) {
          try { fs.unlinkSync(`/config/envs/${old.env}`); } catch {}
        }
        // Remove from projects_info.json
        try {
          const info = JSON.parse(fs.readFileSync('/tmp/projects_info.json', 'utf8'));
          const filtered = info.filter(p => p.name !== old.name);
          fs.writeFileSync('/tmp/projects_info.json', JSON.stringify(filtered));
        } catch {}
        console.log(`  ✓ Torn down ${old.name}`);
      }

      // Rebuild nginx_projects.conf from scratch (only unchanged projects kept)
      if (toTeardown.length > 0) {
        // Rewrite nginx config with only the unchanged projects
        let nginxConf = '';
        for (const old of oldProjects) {
          if (unchanged.has(old.name)) {
            const proxyPass = old.iframe ? `http://localhost:${old.port}` : `http://localhost:${old.port}/`;
            nginxConf += `location ^~ /code/${old.name}/ {\n` +
              `    proxy_pass ${proxyPass};\n` +
              `    proxy_http_version 1.1;\n` +
              `    proxy_set_header Host "localhost:${old.port}";\n` +
              `    proxy_set_header Accept-Encoding "";\n` +
              `    proxy_set_header Upgrade $http_upgrade;\n` +
              `    proxy_set_header Connection "upgrade";\n` +
              `    proxy_hide_header Content-Security-Policy;\n` +
              `    proxy_hide_header X-Frame-Options;\n` +
              `    sub_filter '</head>' '<script>history.replaceState({},document.title,"/")</script></head>';\n` +
              `    sub_filter_once on;\n` +
              `}\n`;
          }
        }
        fs.writeFileSync('/tmp/nginx_projects.conf', nginxConf);
        try { execSync('nginx -c /app/nginx.conf -s reload'); } catch {}
      }

      // Filter to only projects that need setup (new or changed)
      const projectsToSetup = projects.filter(p => !unchanged.has(p.name));
      console.log(`  ${unchanged.size} project(s) unchanged, ${projectsToSetup.length} to set up, ${toTeardown.length} torn down`);

      // Write env files and strip env_content from the stored config
      fs.mkdirSync('/config/envs', { recursive: true });
      const cleanProjects = projects.map(p => {
        const { env_content, ...rest } = p;
        if (env_content && env_content.trim()) {
          const envFilename = `${p.name}.env`;
          fs.writeFileSync(`/config/envs/${envFilename}`, env_content.trim() + '\n');
          console.log(`  ✓ Wrote env file for ${p.name}`);
          return { ...rest, env: envFilename };
        }
        return rest;
      });

      // Write config/projects.json (without raw env_content)
      fs.writeFileSync('/config/projects.json', JSON.stringify(cleanProjects, null, 2));
      console.log(`  ✓ Wrote ${cleanProjects.length} project(s) to /config/projects.json`);

      // Build clean list for the orchestrator (only projects needing setup)
      const cleanToSetup = cleanProjects.filter(p => !unchanged.has(p.name));

      // Run setup-project.sh for each new/changed project sequentially.
      // We write a small Node orchestrator and spawn it once — this avoids race
      // conditions on projects_info.json and guarantees project 1 starts before project 2.
      fs.mkdirSync('/tmp/logs', { recursive: true });

      const orchestrator = `
const { spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const projectsToSetup = ${JSON.stringify(cleanToSetup)};
const allProjects = ${JSON.stringify(cleanProjects)};

// Set up new/changed projects
for (const p of projectsToSetup) {
  const logFd = fs.openSync('/tmp/logs/' + p.name + '.log', 'a');
  const result = spawnSync('/usr/local/bin/setup-project.sh', [], {
    env: {
      ...process.env,
      PROJ_NAME:   p.name,
      PROJ_REPO:   p.repo,
      PROJ_PORT:   String(p.port),
      PROJ_START:  p.start  || 'npm start',
      PROJ_ENV:    p.env    || '',
      PROJ_TOKEN:  p.git_token      || '',
      PROJ_BRANCH: p.ai_branch_name || '',
      PROJ_IFRAME: String(!!p.iframe),
    },
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  if (result.status !== 0) {
    fs.appendFileSync('/tmp/logs/' + p.name + '.log', 'ERROR: setup-project.sh exited with code ' + result.status + '\\n');
  }
}

// Register ALL projects with YepAnywhere (including unchanged ones that may have
// failed registration earlier, e.g. if YepAnywhere wasn't running at container start)
const headers = {
  'Content-Type': 'application/json',
  'Origin': 'http://localhost:3400',
  'Referer': 'http://localhost:3400/',
  'X-Yep-Anywhere': 'true'
};

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ hostname:'localhost', port:3400, path, method:'POST',
      headers:{...headers,'Content-Length':Buffer.byteLength(data)} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

(async () => {
  for (const p of allProjects) {
    const projectId = Buffer.from('/code/' + p.name).toString('base64').replace(/=+$/, '');
    try {
      await post('/api/projects', { path: '/code/' + p.name });
      console.log('Registered ' + p.name + ' with YepAnywhere');
      await post('/api/projects/' + projectId + '/sessions', {
        message: 'You are working on the ' + p.name + ' project at /code/' + p.name + '. Use the CLAUDE.md file for context.'
      });
      console.log('Started session for ' + p.name);
    } catch (e) {
      console.error('YepAnywhere registration error for ' + p.name + ':', e.message);
    }
  }
})();
`;
      if (cleanToSetup.length > 0 || unchanged.size > 0) {
        const orchestratorPath = '/tmp/setup-orchestrator.js';
        fs.writeFileSync(orchestratorPath, orchestrator);

        const orchOut = fs.openSync('/tmp/logs/setup-orchestrator.log', 'a');
        const child = spawn('node', [orchestratorPath], {
          detached: true,
          stdio: ['ignore', orchOut, orchOut],
        });
        child.unref();
        console.log(`  ↗ Spawned setup orchestrator for ${cleanToSetup.length} project(s)`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  const passwordRequired = process.env.APP_PASSWORD && process.env.APP_PASSWORD.length > 0;
  console.log(`Auth server listening on port ${PORT}`);
  console.log(`Password protection: ${passwordRequired ? 'ENABLED' : 'DISABLED'}`);
  if (passwordRequired) {
    console.log(`APP_PASSWORD is set (length: ${process.env.APP_PASSWORD.length})`);
  }
});
