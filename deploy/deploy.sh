#!/usr/bin/env bash
# Runs on the server. Switches the site to one version (an image tag, normally a commit) and goes back to the version
# that was running if the new one does not become healthy.
#
#   ./deploy.sh <image-repo> <tag>      for example: ./deploy.sh ghcr.io/marck-v 6bf4408...
#   ./deploy.sh rollback                go back to the previous version by hand
#
# Expects docker-compose.prod.yml and .env next to it. CI logs in to the registry before calling this.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)
STATE=.deployed            # "<repo> <tag>" of the version running now
PREVIOUS=.deployed.previous

start() { # repo tag
  export IMAGE_REPO="$1" IMAGE_TAG="$2"
  # A pull that fails is not fatal by itself: if the image is really missing, "up" fails next and the rollback runs.
  "${COMPOSE[@]}" pull --quiet --ignore-pull-failures
  # --wait returns only when every service is healthy (or fails after the timeout).
  "${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 120
}

if [[ "${1:-}" == "rollback" ]]; then
  [[ -f $PREVIOUS ]] || { echo "No previous version recorded."; exit 1; }
  read -r repo tag < "$PREVIOUS"
  echo "Rolling back to $tag"
  start "$repo" "$tag"
  cp "$PREVIOUS" "$STATE"
  exit 0
fi

repo="${1:?usage: deploy.sh <image-repo> <tag> | rollback}"
tag="${2:?usage: deploy.sh <image-repo> <tag> | rollback}"

if start "$repo" "$tag"; then
  [[ -f $STATE ]] && cp "$STATE" "$PREVIOUS"
  echo "$repo $tag" > "$STATE"
  echo "Deployed $tag"
  # Old images pile up on a small disk; keep only what the running containers use.
  docker image prune -af --filter "until=168h" >/dev/null || true
  exit 0
fi

echo "The new version did not become healthy. Recent logs:" >&2
"${COMPOSE[@]}" logs --tail 40 >&2 || true
if [[ -f $STATE ]]; then
  read -r old_repo old_tag < "$STATE"
  echo "Going back to $old_tag" >&2
  start "$old_repo" "$old_tag" || echo "Rollback failed too: the site may be down. Check 'docker compose ps' on the server." >&2
fi
exit 1
