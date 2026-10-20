#!/usr/bin/env bash
#
# Deploy JobDraft on the VPS: install (if needed) → build beside the live app →
# swap → pm2 restart → health check → automatic rollback on failure.
#
# Run by .github/workflows/jobdraft-deploy.yml AFTER Tradenaya's "Deploy to VPS"
# has finished, so the checkout already holds the latest code. This script never
# runs git commands that change the checkout, never touches Tradenaya's files,
# its pm2 process or its deploy lock, and modifies no tracked file (so
# Tradenaya's "clean checkout" check keeps passing).
#
# By hand on the server:   bash ~/tradenaya/jobdraft/scripts/deploy.sh
#
# Settings (environment variables):
#   APP_DIR   repo checkout on the server       (default: ~/tradenaya)
#   FORCE=1   rebuild even if jobdraft/ didn't change

set -Eeuo pipefail

APP_DIR="${APP_DIR:-$HOME/tradenaya}"
JD="$APP_DIR/jobdraft"
SERVER_HEALTH="http://127.0.0.1:5055/api/health"
CLIENT_HEALTH="http://127.0.0.1:3055/login"

log() { printf '\n==> %s\n' "$*"; }
fail() { printf '\n!! JOBDRAFT DEPLOY FAILED: %s\n' "$*" >&2; exit 1; }

# Non-interactive SSH sessions don't load the login profile.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null
fi
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"
for cmd in git node npm npx pm2 curl flock sha1sum; do
  command -v "$cmd" >/dev/null || fail "'$cmd' is not installed or not on PATH."
done

[ -d "$JD" ] || fail "$JD not found — has the JobDraft code been merged and pulled?"
cd "$JD"

# One JobDraft deploy at a time (its own lock; Tradenaya's lock is never used).
exec 9>"$JD/.deploy.lock"
flock -n 9 || fail "Another JobDraft deploy is already running."

for app in jobdraft-server jobdraft-client; do
  pm2 describe "$app" >/dev/null 2>&1 \
    || fail "pm2 has no app '$app'. Do the one-time setup first (README → Deploy with pm2)."
done
[ -f server/.env ] || fail "server/.env is missing (one-time setup)."
[ -f client/.env.local ] || fail "client/.env.local is missing (one-time setup)."

# Skip when nothing under jobdraft/ changed since the last successful deploy.
TREE="$(git -C "$APP_DIR" rev-parse HEAD:jobdraft)"
if [ "${FORCE:-0}" != "1" ] && [ -f .deployed-tree ] && [ "$(cat .deployed-tree)" = "$TREE" ]; then
  log "JobDraft is already up to date ($(git -C "$APP_DIR" log -1 --format='%h %s')) — nothing to deploy."
  exit 0
fi
log "Deploying JobDraft at $(git -C "$APP_DIR" log -1 --format='%h %s')"

# Install only when a lockfile changed (npm ci replaces node_modules).
LOCKS="$(sha1sum package-lock.json server/package-lock.json client/package-lock.json)"
if [ ! -f .deploy-state ] || [ "$(cat .deploy-state)" != "$LOCKS" ] || [ ! -d server/node_modules ] || [ ! -d client/node_modules ]; then
  log "Installing dependencies"
  npm ci --no-audit --no-fund
  npm ci --no-audit --no-fund --prefix server
  npm ci --no-audit --no-fund --prefix client
else
  log "Dependencies unchanged"
fi

# Build beside the live app; the running processes keep serving the old build.
log "Building server"
rm -rf server/dist-build
(cd server && npx tsc -p tsconfig.build.json --outDir dist-build) || fail "Server build failed — the live app was not touched."

log "Building client"
rm -rf client/.next-build
(cd client && JOBDRAFT_DIST_DIR=.next-build npx next build) || { rm -rf server/dist-build client/.next-build; fail "Client build failed — the live app was not touched."; }

swap_in() {
  rm -rf server/dist-prev client/.next-prev
  [ -d server/dist ] && mv server/dist server/dist-prev
  [ -d client/.next ] && mv client/.next client/.next-prev
  mv server/dist-build server/dist
  mv client/.next-build client/.next
}

roll_back() {
  log "Rolling back to the previous build"
  rm -rf server/dist-failed client/.next-failed
  [ -d server/dist-prev ] && { mv server/dist server/dist-failed; mv server/dist-prev server/dist; }
  [ -d client/.next-prev ] && { mv client/.next client/.next-failed; mv client/.next-prev client/.next; }
  pm2 restart jobdraft-server jobdraft-client --update-env >/dev/null
}

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "$SERVER_HEALTH" && curl -fsS -o /dev/null "$CLIENT_HEALTH"; then return 0; fi
    sleep 2
  done
  return 1
}

log "Switching to the new build and restarting"
swap_in
pm2 restart jobdraft-server jobdraft-client --update-env >/dev/null

if healthy; then
  echo "$TREE" > .deployed-tree
  echo "$LOCKS" > .deploy-state
  rm -rf server/dist-prev client/.next-prev server/dist-failed client/.next-failed
  pm2 save >/dev/null 2>&1 || true
  pm2 status jobdraft-server jobdraft-client || true
  log "JobDraft deployed ✓"
  exit 0
fi

pm2 logs jobdraft-server --lines 40 --nostream 2>&1 || true
roll_back
if healthy; then
  fail "The new build didn't start, so the previous one was restored and is running. See the logs above."
fi
fail "Rolled back, but JobDraft is still not answering — check 'pm2 logs jobdraft-server' and 'pm2 logs jobdraft-client' on the server now."
