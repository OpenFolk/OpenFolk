#!/bin/sh
set -e
# Bind mounts and volumes created as root belong to root; hand them to "node" first, then drop root. Not
# recursive: everything inside is written by node itself, and the home folder grows large with the engines.
if [ "$(id -u)" = "0" ]; then
    IFS=';'
    for dir in "${DATA_DIR:-/data}" ${ALLOWED_ROOTS:-/work} /home/node; do
        [ -n "$dir" ] || continue
        mkdir -p "$dir"
        chown node:node "$dir"
    done
    unset IFS
    exec gosu node "$@"
fi
exec "$@"
