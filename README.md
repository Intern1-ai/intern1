![Intern1](/app/public/images/intern1_logo_dark.png)

**Leave your desk, keep programming.**

**Intern1** is a self-hosted, containerized AI coding environment that gives you an AI coding agent of your choice + a live project preview in a single browser tab, from any device, anywhere in the world. No laptop or desk required. Just `docker compose up` on your server, and open a URL.

[![Intern1 Dashboard](/app/public/images/demo_img.png)](https://intern1.ai)
AI Editor on the Left, Live Code Preview on the Right.

## Quick Start

```bash
ANTHROPIC_API_KEY=sk-ant-... APP_PASSWORD=changeme docker compose up -d --build
```

Open **http://localhost:3500**, log in, and the onboarding page walks you through the rest:

1. Choose a tunnel mode (or skip for local-only)
2. Add your projects via their GIT repos.
3. Add a git token if the repo is private (credentials are validated in real time)
4. Include .env variables, set a branch, && adjust the start command
5. Hit **Launch**. Your project clones, installs, and starts automatically

> **Alternatively**, pre-configure projects by adding `ANTHROPIC_API_KEY` and `APP_PASSWORD` to a `.env` file and defining repos in `config/projects.json` before starting the container.

## Features

### AI coding agent, ready to go
Claude Code comes pre-installed with bypass permissions in a sandboxed container. A session starts automatically for each project with full context.

### Live split-pane dashboard
Claude Code on the left, your app's live preview on the right. Drag the divider or snap to presets. On mobile, switch between tabs.

### Multi-project workspaces
Run multiple repos in one container. Each gets its own port, branch, start command, env, and preview. Switch between projects with one click.

### 60-second onboarding
Paste a repo URL. The project name auto-fills, git credentials are validated in real time, and your dev server starts in the background. Add .env variables inline.

### Public URLs in one click
Local-only, instant Cloudflare quick tunnel (no account), or persistent named tunnel. All configurable in the onboarding form.

### Built-in Playwright testing
Claude can navigate your app, take screenshots, click buttons, and fill forms through the pre-configured Playwright MCP server.

### Web terminal
Full bash shell right in the dashboard. No SSH needed.

### Real-time logs
Streaming per-project logs with color-coded output and live online/offline status indicators.

> **[Full feature list](FEATURES.md)**

---

## Access Modes

### Local (default)
No extra config. Access at `http://localhost:3500`.

```env
ANTHROPIC_API_KEY=sk-ant-...
APP_PASSWORD=changeme
```

### Quick Tunnel
Instant public URL via Cloudflare. No account needed. URL changes every restart. Select "Quick Tunnel" in the onboarding form, or set in `.env`:

```env
USE_QUICK_TUNNEL=1
```

### Named Tunnel
Persistent subdomain via your own Cloudflare tunnel. Select "Named Tunnel" in onboarding and paste your token, or set in `.env`:

```env
CLOUDFLARE_TUNNEL_TOKEN=eyJh...
```

Get your token by running `cloudflared tunnel token <TUNNEL_NAME>` or from the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com) under **Networks > Tunnels > your tunnel > Configure**.

Configure a public hostname pointing to `http://localhost:3500` in your tunnel's settings.

---

## Dashboard Password

Set `APP_PASSWORD` when starting the container:

```bash
APP_PASSWORD=your_secure_password docker compose up -d --build
```

Or add it to your `.env` file:
```env
APP_PASSWORD=your_secure_password
```

Leave `APP_PASSWORD` blank to disable the login gate.

> **Note:** A warning banner appears if you're using the default password `changeme`.

---

## Architecture

```
Docker Container (intern1)
|
+-- Nginx (:3500) -- single entry point
|   +-- /           -> React dashboard
|   +-- /yep/       -> Claude Code (YepAnywhere)
|   +-- /api/auth/* -> Auth server
|   +-- /api/*      -> YepAnywhere API + WebSocket
|   +-- /code/NAME/ -> Per-project reverse proxies
|   +-- /shell/     -> Web terminal (ttyd)
|
+-- YepAnywhere (:3400, internal)
|   +-- Claude Code with bypass permissions
|   +-- Auto-starts session per project
|
+-- Auth Server (:3600, internal)
|   +-- Password auth, session management
|   +-- Project status, git operations
|   +-- Onboarding setup endpoint
|
+-- Projects (cloned to /code/NAME/)
|   +-- Each gets its own port and nginx route
|   +-- Vite auto-detected with base path injection
|
+-- cloudflared (optional)
    +-- Quick tunnel or named tunnel
```

---

## License

AGPL-3.0. Free for solo developers. Companies and teams require a commercial license. See [intern1.ai](https://intern1.ai) for details.

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude Code API key |
| `APP_PASSWORD` | No | Dashboard login password |
| `USE_QUICK_TUNNEL` | No | Set to `1` for temporary public URL |
| `CLOUDFLARE_TUNNEL_TOKEN` | No | Cloudflare named tunnel token |

Git tokens and per-project env files are configured in the onboarding form or in `config/projects.json`.

---

**Get untethered. Ship from anywhere.** [intern1.ai](https://intern1.ai)
