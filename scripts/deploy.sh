#!/usr/bin/env bash
#
# Deploy Game Explorer on the Mac mini (GAMEEXPLOR-0002).
#
#   ~/projects/game-explorer/scripts/deploy.sh
#
# Pull, install, migrate, build, restart. The LaunchAgent
# (ops/com.angelodipaolo.game-explorer.plist) keeps `npm run start` alive; this
# script only replaces what it is serving. Nothing here touches the database
# beyond `prisma migrate deploy`, and nothing here touches `.env`.
#
# Run it on the mini. It is not a remote deploy tool and never will be one.
set -euo pipefail

cd "$(dirname "$0")/.."
LABEL="com.angelodipaolo.game-explorer"
PORT="${PORT:-3000}"

echo "==> git pull --ff-only"
git pull --ff-only

echo "==> npm ci"
npm ci

# Backup before migrating: `migrate deploy` is the one step here that can
# change data, and the collection is the part of this that is not replaceable.
echo "==> npm run backup"
npm run backup

echo "==> prisma migrate deploy"
npx prisma migrate deploy

echo "==> npm run build"
npm run build

echo "==> restart $LABEL"
if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$UID/$LABEL"
else
  echo "!! $LABEL is not loaded — see ops/README.md, then:"
  echo "   launchctl bootstrap gui/$UID ~/Library/LaunchAgents/$LABEL.plist"
  exit 1
fi

echo "==> waiting for http://localhost:$PORT"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost:$PORT/"; then
    echo "==> serving"
    curl -sI "http://localhost:$PORT/" | grep -i '^x-robots-tag' || true
    exit 0
  fi
  sleep 1
done

echo "!! it never answered. Logs: ~/Library/Logs/game-explorer/"
exit 1
