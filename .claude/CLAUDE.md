# intern1 — AI Development Container

A Docker container that gives Claude Code a sandboxed environment with live project previews. It bundles Claude Code (via YepAnywhere), a React split-pane dashboard, an auth server, and dynamically cloned git projects — all exposed through a single port or Cloudflare tunnel.

The dashboard shows Claude Code on the left and a project preview on the right, with a draggable divider and snap controls. On mobile it switches to a tab view. The Status panel shows all projects' online state and lets users click iframe-enabled projects to switch the preview. A Git panel provides commit/push/discard controls per project. Access is optionally gated by `APP_PASSWORD` in `config/envs/app.env`.

**IMPORTANT**: All running projects are listed at the end of this file with their URLs, branches, and Playwright testing examples. Scroll down to see the "RUNNING PROJECTS" section which is dynamically generated at container startup.

## Architecture

```
Docker Container (intern1)
│
├── Nginx (:3500) — single entry point
│   ├── /                → React dashboard (static from /app/dist)
│   ├── /yep/            → YepAnywhere proxy (CSP/X-Frame-Options stripped for iframing)
│   ├── /yep/assets/     → YepAnywhere assets (no sub_filter to avoid HTML fallback)
│   ├── /api/auth/*      → Auth server proxy
│   ├── /api/*           → YepAnywhere API + WebSocket proxy
│   └── /code/{name}/    → Per-project reverse proxies (generated dynamically)
│
├── YepAnywhere (:3400, internal)
│   └── Claude Code terminal (globally installed via npm)
│   └── Pre-configured with bypass permissions enabled
│
├── Auth Server (:3600, internal)
│   ├── POST /login      → Password validation, sets HTTP-only session cookie
│   ├── GET  /verify     → Session check
│   ├── GET  /status     → Project online status (polls each project port)
│   ├── GET  /git        → Git status + diff stats per project
│   ├── POST /commit     → git add -A, commit, push for a project
│   ├── POST /discard    → git restore + clean for a project
│   └── POST /logout     → Clear session
│
├── React Dashboard (served from /app/dist)
│   ├── Desktop: split-pane with draggable/snappable divider
│   │   ├── Left: Claude Code iframe (/yep/)
│   │   └── Right: project iframe, Status panel, or Git panel
│   ├── Mobile: tab bar (Intern1 | App | Git | Status)
│   ├── StatusPanel: shows project online/offline state, click iframe projects to switch preview
│   ├── GitPanel: commit message input, push, discard per project
│   └── ProjectBar: shows active project name + git branch above the iframe
│
├── Projects (cloned to /code/{name}/ from config/projects.json)
│
└── cloudflared (optional) → exposes :3500 publicly
```

## Key Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Node 20 base; installs Claude Code, YepAnywhere, cloudflared, nginx, dev tools |
| `docker-compose.yml` | Port mappings, env vars, volumes |
| `config/projects.json` | Defines repos to clone, how to run them, and git credentials |
| `config/envs/app.env` | `APP_PASSWORD` for dashboard login |
| `config/envs/*.env` | Per-project environment files (copied to `/code/{name}/.env`) |
| `start.sh` | Container entrypoint — orchestrates everything |
| `nginx.conf` | Single-port routing: dashboard, YepAnywhere proxy, auth API, project proxies |
| `auth-server.js` | Node HTTP server for login, project status, git operations |
| `app/src/App.jsx` | Entire React dashboard (single-file: login, layout, panels, divider) |
| `init-firewall.sh` | Optional: restricts outbound traffic to a domain whitelist |

## Projects System

Projects are defined in `config/projects.json`. Each entry:

```json
{
  "name": "ui",
  "repo": "https://github.com/your-org/your-repo.git",
  "port": 3001,
  "start": "npm start",
  "env": "ui.env",
  "git_token": "access_token_to_clone_repo",
  "ai_branch_name": "the_branch_you_want_intern1_to_work_on",
  "iframe": true
}
```

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | Yes | Directory name under `/code/`, nginx path prefix, display name |
| `repo` | Yes | Git clone URL (HTTPS or SSH) |
| `port` | Yes | Port the project dev server listens on |
| `start` | No | Start command (default: `npm start`; Vite auto-detected and `--base` injected) |
| `env` | No | Env file from `config/envs/` copied to project `.env` |
| `git_token` | No | Access token injected into HTTPS clone URL as credentials |
| `ai_branch_name` | No | Branch to checkout (created if missing); merges from main/master |
| `iframe` | No | If `true`, project appears as clickable in the Status panel to preview in the right iframe |

Multiple projects can use the same `git_token` value. Projects on different git hosts (e.g. GitLab vs GitHub) can each have their own token.

## Startup Sequence (`start.sh`)

1. Load `config/envs/app.env` (for `APP_PASSWORD`)
2. Set git identity (`intern1` / `intern1@intern1.local`)
3. Start core services: YepAnywhere (:3400), Nginx (:3500), Auth server (:3600)
4. Start Cloudflare tunnel if configured
5. For each project in `config/projects.json`:
   a. Clone repo (inject `git_token` into URL if set)
   b. Checkout `ai_branch_name` and merge from main/master if set
   c. Record project info to `/tmp/projects_info.json` (name, branch, port, iframe)
   d. Copy env file, `npm install`
   e. Auto-detect Vite → override start command with `--base=/code/{name}/`
   f. Start project in background
   g. Generate nginx proxy config for `/code/{name}/`
   h. If `iframe: true`, background-wait for port ready then update `/app/dist/config.json`
6. Reload nginx to pick up project routes
7. Register project paths with YepAnywhere API
8. `tail -f /dev/null` to keep container alive

## Dashboard UI Details

**Desktop layout**: Horizontal split-pane with percentage-based sizing. The center divider has:
- Drag handle for free resizing
- Snap buttons: full left (100%), 50/50, full right (0%)
- Git toggle button (branch icon)
- Status toggle button (activity icon)

**Right panel priority**: Status mode → Git mode → iframe (if `rightUrl` set) → Status fallback

**Project switching**: The Status panel lists all projects with online/offline indicators. Iframe-enabled projects that are online show "click to view" — clicking one switches the right iframe to `/code/{name}/` and exits status mode.

**Config polling**: The React app fetches `/config.json` on load and polls every 3s until `rightUrl` is populated (first iframe project comes online). The Status panel polls `/api/auth/status` every 3s for live port checks.

## Cloudflare Tunnel Modes

| Mode | Config | Result |
|------|--------|--------|
| Local | (no tunnel vars) | `http://localhost:3500` only |
| Quick tunnel | `USE_QUICK_TUNNEL=1` | Temporary `trycloudflare.com` URL |
| Named tunnel | `CLOUDFLARE_TUNNEL_TOKEN` + `TUNNEL_URL` | Persistent subdomain |

## Environment Variables (docker-compose)

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Claude Code API key |
| `CLOUDFLARE_TUNNEL_TOKEN` | Named tunnel only | Cloudflare tunnel token |
| `TUNNEL_URL` | Named tunnel only | Public URL for the dashboard |
| `USE_QUICK_TUNNEL` | Quick tunnel only | Set to `1` |

Git credentials and `APP_PASSWORD` are configured in `config/projects.json` and `config/envs/app.env` respectively (mounted read-only via `./config:/config:ro`).

## Ports (internal)

| Port | Service |
|------|---------|
| 3400 | YepAnywhere (internal, proxied via `/yep/`) |
| 3500 | Nginx — only port exposed to host |
| 3600 | Auth server (internal, proxied via `/api/auth/`) |
| 3001+ | Project dev servers (internal, proxied via `/code/{name}/`) |

## Testing Projects with Playwright

You have access to the **Playwright MCP server** configured in `~/.claude/settings.json`. Use it to:

- **Navigate** to any project at `http://localhost:3500/code/{name}/`
- **Take screenshots** to verify UI appearance
- **Interact** with pages (click, fill forms, etc.)
- **Extract data** from rendered pages

See the "RUNNING PROJECTS" section below for specific URLs and ready-to-use Playwright commands for each project. Use Playwright to test UI changes, verify functionality, or debug rendering issues.
