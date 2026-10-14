#!/bin/sh
# Runs first in the container. Some hosts (Railway, for one) attach the data volume owned by root, and the app runs as
# the unprivileged "node" user, which could then not write its database. So while still root: give the data folder to
# "node", then drop root for good and start the app as "node".
set -e

if [ "$(id -u)" = "0" ]; then
  data_dir=$(dirname "${DB_PATH:-/data/backlog.db}")
  mkdir -p "$data_dir"
  chown -R node:node "$data_dir"
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

exec "$@"
