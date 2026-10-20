# Backend image: a machine that never sleeps, e.g. on a server. The build context is the repo root, because
# shared/ lives next to local/; local/Dockerfile.dockerignore replaces the root .dockerignore for this build.
#
#   docker build -f local/Dockerfile -t openfolk-local .
#
# Three places hold state and belong on volumes: /home/node (the sign-ins of Claude, Codex, Copilot, Cursor,
# Antigravity and OpenCode, plus the Cursor and Antigravity programs), /data (DATA_DIR: bots, history, knowledge) and /work
# (ALLOWED_ROOTS: the folders the bots work in).
FROM node:22-bookworm-slim

# gosu: the entrypoint hands the volumes to "node" and then drops root. git: the bots' repositories.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git gosu openssh-client \
    && rm -rf /var/lib/apt/lists/*

# The Claude Code CLI for the one-time sign-in (`claude`); the sessions run on the binary bundled with the Agent SDK.
# Pinned to the version that SDK bundles (claudeCodeVersion in its package.json), so a rebuild gives the same image.
ARG CLAUDE_CODE_VERSION=2.1.296
# The npm cache is cleaned in the same layer, otherwise it stays in the image (~0.7 GB after npm ci).
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} --no-audit --no-fund \
    && npm cache clean --force

WORKDIR /app
COPY package.json package-lock.json ./
COPY local/package.json local/
# npm installs the musl builds of the Agent SDK and Copilot next to the glibc ones (~0.4 GB); this image is glibc
# (bookworm), so they are never loaded. Codex ships only a musl binary, it lives inside codex-linux-* and stays.
RUN npm ci -w local --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && rm -rf node_modules/@*/*musl* node_modules/opencode-*-musl
COPY shared ./shared
COPY local/src ./local/src
COPY local/tools ./local/tools
COPY local/tsconfig.json ./local/
COPY local/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
# gosu keeps the environment, so the home of "node" must be explicit: the engines store their sign-ins there
ENV HOME=/home/node
ENV DATA_DIR=/data
# The setup checklist shows the docker compose commands instead of the ones for a terminal
ENV OPENFOLK_CONTAINER=1
ENV ALLOWED_ROOTS=/work
# A container neither shuts down nor signs in a Windows user
ENV SHUTDOWN_METHOD=none
ENV AUTOLOGON_METHOD=none
# The global CLI must not replace itself under /usr/local; updates come with the image
ENV DISABLE_AUTOUPDATER=1
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data /work && chown node:node /data /work
VOLUME ["/home/node", "/data", "/work"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "local/src/index.ts"]
