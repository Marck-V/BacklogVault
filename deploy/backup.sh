#!/usr/bin/env bash
# Runs on the server from cron, once a night:
#   15 3 * * * /home/<you>/backlogvault/backup.sh >> /home/<you>/backlogvault/backup.log 2>&1
#
# 1. Asks the API to write a consistent copy of the database (safe while the site is running).
# 2. Copies that file out of the Docker volume into ./backups on the server (the newest 14 are kept).
# 3. If BACKUP_BUCKET is set in .env (for example gs://backlogvault-backups), uploads it there, so losing the server's
#    disk does not lose the data. A backup that only lives on the same disk is not really a backup.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)
read -r IMAGE_REPO IMAGE_TAG < .deployed
export IMAGE_REPO IMAGE_TAG

line=$("${COMPOSE[@]}" exec -T api npm run --silent backup)
echo "$(date -u +%FT%TZ) $line"
file=$(echo "$line" | grep -o '/data/backups/backlog-[0-9-]*\.db')

mkdir -p backups
"${COMPOSE[@]}" cp "api:$file" "backups/"
ls -1t backups/backlog-*.db | tail -n +15 | xargs -r rm -f

bucket=$(grep -E '^BACKUP_BUCKET=' .env | cut -d= -f2- || true)
if [[ -n "$bucket" ]]; then
  gcloud storage cp "backups/$(basename "$file")" "$bucket/" --quiet
  echo "$(date -u +%FT%TZ) uploaded $(basename "$file") to $bucket"
else
  echo "$(date -u +%FT%TZ) BACKUP_BUCKET is not set: the backup is only on this server" >&2
fi
