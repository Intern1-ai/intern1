FROM node:20-slim AS app-builder

# Build the React app (separate stage to avoid keeping dev dependencies)
COPY app /app
WORKDIR /app
RUN npm install && npm run build

# Main image
FROM node:20-slim

ARG TZ
ENV TZ="$TZ"

ARG CLAUDE_CODE_VERSION=latest

# Install essential packages only
RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  procps \
  sudo \
  wget \
  gnupg2 \
  ca-certificates \
  jq \
  nano \
  nginx \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Google Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
  echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
  apt-get update && \
  apt-get install -y google-chrome-stable && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Install cloudflared
RUN ARCH=$(dpkg --print-architecture) && \
  wget -q "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" && \
  dpkg -i "cloudflared-linux-${ARCH}.deb" && \
  rm "cloudflared-linux-${ARCH}.deb"

# Install ttyd (web terminal)
RUN ARCH=$(dpkg --print-architecture) && \
  case "$ARCH" in \
    amd64) TTYD_ARCH="x86_64" ;; \
    arm64) TTYD_ARCH="aarch64" ;; \
    *) TTYD_ARCH="$ARCH" ;; \
  esac && \
  wget -q "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.${TTYD_ARCH}" -O /usr/local/bin/ttyd && \
  chmod +x /usr/local/bin/ttyd

ARG USERNAME=node

# Create directories and set permissions
RUN mkdir -p /workspace /code /commandhistory /home/node/.claude /usr/local/share/npm-global && \
  touch /commandhistory/.bash_history && \
  chown -R node:node /workspace /code /commandhistory /home/node/.claude /usr/local/share

# Persist bash history
RUN echo 'export PROMPT_COMMAND="history -a" && export HISTFILE=/commandhistory/.bash_history' >> /home/node/.bashrc

ENV DEVCONTAINER=true

# Copy Claude Code settings and context
COPY --chown=node:node .claude/settings.json /home/node/.claude/settings.json
COPY --chown=node:node .claude/CLAUDE.md /home/node/.claude/CLAUDE.md

WORKDIR /workspace

# Set up non-root user
USER node

# Install global packages
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

ENV EDITOR=nano
ENV VISUAL=nano

# Install Claude Code, YepAnywhere, and Playwright
RUN npm install -g --no-audit --no-fund \
  @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
  yepanywhere \
  playwright \
  @playwright/mcp && \
  npm cache clean --force

# Switch to root to install Playwright dependencies
USER root
RUN npx playwright install-deps chrome
USER node

# Bake in Claude Code settings: Playwright MCP + auto-approve all tools (sandboxed container)
RUN mkdir -p /home/node/.claude && \
  echo '{"mcpServers":{"playwright":{"command":"playwright-mcp","args":["--no-sandbox"],"env":{"DISPLAY":""}}},"permissions":{"allow":["Bash(*)","Read(*)","Write(*)","Edit(*)","Glob(*)","Grep(*)","WebFetch(*)","WebSearch(*)","mcp__*"]}}' > /home/node/.claude/settings.json

# Copy built React app from builder stage
COPY --from=app-builder --chown=node:node /app/dist /app/dist
COPY --chown=node:node nginx.conf /app/nginx.conf
COPY --chown=node:node auth-server.js /app/auth-server.js

# Copy startup and firewall scripts
COPY init-firewall.sh /usr/local/bin/
COPY start.sh /usr/local/bin/start.sh
COPY setup-project.sh /usr/local/bin/setup-project.sh

USER root
RUN chmod +x /usr/local/bin/init-firewall.sh /usr/local/bin/start.sh /usr/local/bin/setup-project.sh && \
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall && \
  chmod 0440 /etc/sudoers.d/node-firewall && \
  echo "node ALL=(root) NOPASSWD: /usr/bin/cloudflared, /usr/bin/pkill" > /etc/sudoers.d/node-cloudflared && \
  chmod 0440 /etc/sudoers.d/node-cloudflared

USER node

EXPOSE 3400 3401 3500

CMD ["/usr/local/bin/start.sh"]
