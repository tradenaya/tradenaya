#!/usr/bin/env bash
#
# Deploy the latest `main` on the VPS — the same steps as a manual deploy
# (pull → install → build → pm2 restart → check), made safe to run unattended:
#
#   * The new version is built into .next-build while the live app keeps
#     serving from .next, so a failed build changes nothing.
#   * After the restart the app must answer on HEALTH_URL; if it doesn't, the
#     previous build + code are restored and restarted automatically.
#
# Run by .github/workflows/deploy.yml after every merge to main. It can also be
# run by hand on the server:   bash ~/tradenaya/scripts/deploy.sh
#
# Settings (environment variables):
#   APP_DIR     app checkout on the server   (default: ~/tradenaya)
#   PM2_APP     pm2 process name             (default: tradenaya — see `pm2 list`)
#   PORT        port the app listens on      (default: 3000)
#   BRANCH      branch to deploy             (default: main)
#   HEALTH_URL  page that must return 200    (default: http://127.0.0.1:$PORT/signin)
#   FORCE=1     rebuild even if already at the latest commit

set -Eeuo pipefail

APP_DIR="${APP_DIR:-$HOME/tradenaya}"
PM2_APP="${PM2_APP:-tradenaya}"
PORT="${PORT:-3000}"
BRANCH="${BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/signin}"
BUILD_DIR=".next-build"

log() { printf '\n==> %s\n' "$*"; }
fail() { printf '\n!! DEPLOY FAILED: %s\n' "$*" >&2; exit 1; }

# Non-interactive SSH sessions don't load the login profile, so node/npm/pm2
# installed through nvm or npm -g may not be on PATH yet.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null
fi
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"
for cmd in git node npm pm2 curl flock; do
  command -v "$cmd" >/dev/null || fail "'$cmd' is not installed or not on PATH."
done

cd "$APP_DIR" || fail "App folder $APP_DIR not found."

# One deploy at a time.
exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || fail "Another deploy is already running."

pm2 describe "$PM2_APP" >/dev/null 2>&1 \
  || fail "pm2 has no app named '$PM2_APP'. Run 'pm2 list' on the server and set PM2_APP (GitHub → Settings → Variables)."

if ! git diff --quiet || ! git diff --cached --quiet; then
  git status --short
  fail "The server copy has uncommitted changes to tracked files (listed above). Commit or discard them on the server, then deploy again."
fi

# The commit the LIVE build was made from, recorded after each successful
# deploy. The checkout's HEAD alone isn't enough: a deploy interrupted after
# the pull but before the build would leave new code with the old build, and
# "HEAD is up to date" would then wrongly skip the rebuild.
MARKER=".next/.deployed-commit"
DEPLOYED=""
if [ -f "$MARKER" ] && git cat-file -e "$(cat "$MARKER")^{commit}" 2>/dev/null; then
  DEPLOYED="$(cat "$MARKER")"
fi
# Roll back to what is actually live (falls back to HEAD the first time).
PREV="${DEPLOYED:-$(git rev-parse HEAD)}"

log "Fetching origin/$BRANCH"
git fetch --quiet origin "$BRANCH"
NEXT="$(git rev-parse "origin/$BRANCH")"

if [ "$DEPLOYED" = "$NEXT" ] && [ "${FORCE:-0}" != "1" ]; then
  log "Already running $(git log -1 --format='%h %s') — nothing to deploy."
  exit 0
fi
if [ -z "$DEPLOYED" ]; then
  log "No record of which commit is live yet — doing a full build to be safe."
fi

log "Updating $(git log -1 --format='%h' "$PREV") → $(git log -1 --format='%h %s' "$NEXT")"
git merge --ff-only --quiet "origin/$BRANCH" \
  || fail "The server's $BRANCH has diverged from origin/$BRANCH, so it can't fast-forward. Fix the server checkout by hand."

DEPS_CHANGED=0
if ! git diff --quiet "$PREV" "$NEXT" -- package.json package-lock.json; then DEPS_CHANGED=1; fi

install_deps() {
  log "Installing dependencies (package files changed)"
  npm ci --no-audit --no-fund
}

restore_code() {
  log "Restoring code to $(git log -1 --format='%h' "$PREV")"
  git reset --hard --quiet "$PREV"
  if [ "$DEPS_CHANGED" = "1" ]; then install_deps || true; fi
}

# `next build` adds its output folder to tsconfig.json; undo that so the
# checkout stays clean for the next pull.
clean_build_side_effects() { git checkout --quiet -- tsconfig.json 2>/dev/null || true; }

if [ "$DEPS_CHANGED" = "1" ]; then
  install_deps || { restore_code; fail "npm ci failed — the live app was not touched."; }
fi

log "Building into $BUILD_DIR (the live app keeps running meanwhile)"
rm -rf "$BUILD_DIR"
if ! NEXT_DIST_DIR="$BUILD_DIR" npm run build; then
  clean_build_side_effects
  rm -rf "$BUILD_DIR"
  restore_code
  fail "Build failed — the live app was not touched and is still running the previous version."
fi
clean_build_side_effects

log "Switching to the new build"
rm -rf .next-prev
if [ -d .next ]; then mv .next .next-prev; fi
mv "$BUILD_DIR" .next

healthy() {
  local code=""
  for _ in $(seq 1 45); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
    if [ "$code" = "200" ]; then return 0; fi
    sleep 2
  done
  echo "Last response from $HEALTH_URL: ${code:-no response}"
  return 1
}

log "Restarting pm2 app '$PM2_APP'"
pm2 restart "$PM2_APP" --update-env >/dev/null

log "Checking $HEALTH_URL"
if healthy; then
  git rev-parse HEAD > "$MARKER"
  pm2 save >/dev/null 2>&1 || true
  pm2 status "$PM2_APP" || true
  log "Deployed $(git log -1 --format='%h %s') ✓"
  exit 0
fi

log "New version did not come up — recent app logs:"
pm2 logs "$PM2_APP" --lines 40 --nostream 2>&1 || true

log "Rolling back"
rm -rf .next-failed
mv .next .next-failed
if [ -d .next-prev ]; then mv .next-prev .next; fi
restore_code
pm2 restart "$PM2_APP" --update-env >/dev/null
if healthy; then
  fail "The new version failed its health check, so the previous version was restored and is running. Its build is kept in .next-failed for debugging."
fi
fail "Rolled back, but the app is still not answering on $HEALTH_URL — check 'pm2 logs $PM2_APP' on the server now."
