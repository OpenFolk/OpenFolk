#!/bin/sh
set -e
# Volumes created by older images (running as root) or bind mounts belong to root; hand them to "node" first
if [ "$(id -u)" = "0" ]; then
    mkdir -p "${RELAY_DATA:-/data}"
    chown -R node:node "${RELAY_DATA:-/data}"
    exec su-exec node "$@"
fi
exec "$@"
