# Relay image for any container platform (Docker, Coolify, Fly.io, ...). The build context is the repo root,
# because webapp/ and shared/ live next to relay/.

# ---- build: TypeScript to JavaScript (dist/)
FROM node:22-alpine AS build
WORKDIR /app
# The root lockfile pins every version; npm ci needs the package.json of each workspace it names
COPY package.json package-lock.json ./
COPY relay/package.json relay/
COPY local/package.json local/
RUN npm ci -w relay --no-audit --no-fund
COPY shared ./shared
COPY relay/src ./relay/src
COPY relay/tsconfig.json relay/tsconfig.build.json ./relay/
RUN cd relay && npm run build

# ---- run: only the relay's runtime dependencies (without the Agent SDK of the local part) and the build
FROM node:22-alpine
WORKDIR /app
# su-exec: the entrypoint hands /data to the user "node" and then drops root
RUN apk add --no-cache su-exec
COPY package.json package-lock.json ./
COPY relay/package.json relay/
COPY local/package.json local/
RUN npm ci -w relay --omit=dev --no-audit --no-fund
COPY webapp ./webapp
COPY --from=build /app/relay/dist ./relay/dist
COPY relay/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
ENV RELAY_PORT=8787
# Signed-in devices, machines seen and the wake schedule; mount a persistent volume here
ENV RELAY_DATA=/data
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "relay/dist/relay/src/server.js"]
