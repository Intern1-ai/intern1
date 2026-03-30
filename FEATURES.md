# Intern1 Features

## Code from any device
Open a browser on your phone, tablet, or any laptop — your full AI development environment is right there. No IDE, no desktop app, no setup. Just a URL and a password.

## AI coding agent, ready to go
Claude Code comes pre-installed and pre-configured with bypass permissions in a sandboxed container. It starts a session for each project automatically with full context — your repo, branch, and project docs.

## See changes as they happen
Split-pane dashboard shows Claude Code on the left and your app's live preview on the right. Drag the divider, snap to presets, or switch to full-screen. On mobile, swipe between tabs.

## Multi-project workspaces
Run multiple repos in a single container. Each gets its own port, branch, start command, environment variables, and live preview. Switch between project previews with one click.

## 60-second onboarding
Paste a repo URL and a git token. The project name auto-fills, credentials are validated in real time, and your dev server starts in the background. Add .env variables inline — no file juggling.

## Public URLs in one click
Choose between local-only access, an instant temporary Cloudflare URL (no account needed), or a persistent subdomain with your own tunnel. Configured right in the onboarding form.

## Built-in Playwright testing
Claude can navigate your running app, take screenshots, click buttons, and fill forms — all through the Playwright MCP server, pre-configured to work inside Docker.

## Web terminal
Full bash shell accessible from the dashboard. Run commands, inspect logs, or debug without leaving the browser.

## Real-time project logs
Streaming logs per project with color-coded output — errors in red, warnings in orange, ready/success in green. Live online/offline status indicators update every 3 seconds.

## Auto-detects your stack
Vite projects are detected automatically — base paths, host binding, and port configuration are injected without touching your code. Just set a port and a start command.

## Branch management
Specify an AI branch per project. Intern1 checks it out (or creates it), merges from main, and displays the current branch everywhere in the UI.

## Single-port deployment
Everything — dashboard, AI terminal, project previews, auth, shell — is proxied through one port. One `docker compose up` and you're live.

## Password protection
Optional APP_PASSWORD gates access with secure HTTP-only session cookies. A warning banner appears if you're still using the default password.

## Container isolation
Projects run in Docker with a non-root user. Optional outbound firewall restricts network access to a whitelist (GitHub, npm, Anthropic). Your host machine stays clean.
