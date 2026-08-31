#!/usr/bin/env bash
#
# Deploy Game Explorer if — and only if — `origin/main` has moved
# (GAMEEXPLOR-0002).
#
#   ~/projects/game-explorer/scripts/deploy-if-changed.sh
#
# This is the unattended half of the deploy story: a LaunchAgent timer
# (ops/com.angelodipaolo.game-explorer-deploy.plist) runs it every few minutes,
# it asks GitHub whether `main` moved, and it calls `scripts/deploy.sh` when the
# answer is yes. The mini reaches *out*; nothing reaches in. That is the same
# trade the tunnel makes, and the reason this is a poller and not a webhook or a
# self-hosted CI runner.
#
# It does not know how to deploy. `scripts/deploy.sh` does, and this calls it.
#
# The timer owns `main`. If you want to hand-deploy, roll back to an older SHA,
# or test a branch on the mini, `launchctl bootout` the timer first — otherwise
# it will pull you back onto `main` within one interval. See ops/README.md.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"

LOG_DIR="${GAME_EXPLORER_LOG_DIR:-$HOME/Library/Logs/game-explorer}"
LOG="$LOG_DIR/deploy.log"
LOCK="$LOG_DIR/deploy.lock"
BRANCH="main"
REMOTE="origin"

mkdir -p "$LOG_DIR"

# Every line goes to both the log and stdout, so a hand-run and a timer tick
# leave the same trail.
log() { printf '%s  %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$*" | tee -a "$LOG"; }

# --- lock ---------------------------------------------------------------
# `mkdir` is the atomic primitive macOS gives us without flock. A build takes
# minutes and the timer ticks in minutes, so overlap is a real case, not a
# theoretical one: the second tick logs and leaves rather than stacking.
if ! mkdir "$LOCK" 2>/dev/null; then
  holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [[ -z "$holder" ]]; then
    # The lock dir exists but carries no pid yet. Almost always this is another
    # run that won the `mkdir` microseconds ago and is about to write its pid on
    # the next line — so back off rather than reclaim, or we'd race it into two
    # concurrent deploys. The one exception is a run that died in that tiny
    # window, which would leave a pidless lock forever; guard against a permanent
    # wedge by reclaiming only once the dir is far older than that startup gap.
    lock_age=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || echo 0) ))
    if (( lock_age < 60 )); then
      log "a deploy is starting up (lock held, pid not yet written) — skipping this tick"
      exit 0
    fi
    log "lock has no pid and is ${lock_age}s old — treating as broken, reclaiming"
  elif [[ "$holder" =~ ^[0-9]+$ ]] && kill -0 "$holder" 2>/dev/null; then
    log "a deploy is already running (pid $holder) — skipping this tick"
    exit 0
  else
    # A real pid that names no live process: a previous run was killed mid-deploy.
    log "stale lock (pid ${holder:-unknown}) — reclaiming"
  fi
  rm -rf "$LOCK"
  if ! mkdir "$LOCK" 2>/dev/null; then
    log "!! could not take the lock at $LOCK — skipping this tick"
    exit 0
  fi
fi
echo "$$" >"$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

# --- is the checkout in a state we may touch? ---------------------------
if [[ -n "$(git status --porcelain)" ]]; then
  log "!! working tree is dirty — refusing to deploy. Commit, stash or clean $REPO."
  exit 1
fi

log "fetching $REMOTE/$BRANCH"
if ! git fetch --quiet "$REMOTE" "$BRANCH" 2>>"$LOG"; then
  log "!! git fetch failed — network or credentials. Trying again next tick."
  exit 1
fi

remote_sha="$(git rev-parse --verify --quiet "refs/remotes/$REMOTE/$BRANCH" || true)"
if [[ -z "$remote_sha" ]]; then
  log "!! cannot resolve $REMOTE/$BRANCH — is this a clone of the right repo?"
  exit 1
fi

# --- make sure we are on main, and only main ----------------------------
# Deploy `main` only. Half-finished branch work must never auto-ship, so we name
# the branch explicitly rather than trusting whatever HEAD happens to be.
head_ref="$(git symbolic-ref --quiet --short HEAD || echo "(detached)")"
if [[ "$head_ref" != "$BRANCH" ]]; then
  log "!! HEAD is on '$head_ref', not '$BRANCH' — switching back to $BRANCH."
  log "   (bootout this timer before hand-deploying or rolling back; see ops/README.md)"
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    if ! git checkout --quiet "$BRANCH" 2>>"$LOG"; then
      log "!! could not switch to $BRANCH — resolve by hand in $REPO. Skipping this tick."
      exit 1
    fi
  else
    if ! git checkout --quiet -b "$BRANCH" --track "$REMOTE/$BRANCH" 2>>"$LOG"; then
      log "!! could not create tracking branch $BRANCH — resolve by hand. Skipping this tick."
      exit 1
    fi
  fi
fi

# `scripts/deploy.sh` runs `git pull --ff-only`, which needs an upstream.
if ! git rev-parse --verify --quiet "$BRANCH@{upstream}" >/dev/null; then
  log "$BRANCH had no upstream — tracking $REMOTE/$BRANCH"
  git branch --quiet --set-upstream-to="$REMOTE/$BRANCH" "$BRANCH"
fi

local_sha="$(git rev-parse --verify "refs/heads/$BRANCH")"

# --- decide -------------------------------------------------------------
if [[ "$local_sha" == "$remote_sha" ]]; then
  log "no change ($BRANCH at ${local_sha:0:7})"
  exit 0
fi

# `git pull --ff-only` would fail on a rewritten history; say so here, where the
# message can name the cause, instead of letting deploy.sh die halfway.
if ! git merge-base --is-ancestor "$local_sha" "$remote_sha"; then
  log "!! $REMOTE/$BRANCH (${remote_sha:0:7}) is not a fast-forward of local $BRANCH (${local_sha:0:7})."
  log "   Someone force-pushed, or this checkout has commits of its own. Fix it by hand."
  exit 1
fi

count="$(git rev-list --count "$local_sha..$remote_sha")"
subject="$(git log -1 --format=%s "$remote_sha")"
log "deploying ${local_sha:0:7}..${remote_sha:0:7} ($count commit(s)) — $subject"

# --- deploy -------------------------------------------------------------
# Fail loud but non-fatal: deploy.sh backs up before it migrates, and a failed
# build leaves the LaunchAgent serving the build it already has. The next tick
# tries again, and a fixing push recovers on its own.
started="$SECONDS"
if scripts/deploy.sh >>"$LOG" 2>&1; then
  log "deployed ${remote_sha:0:7} in $((SECONDS - started))s"
else
  status="$?"
  log "!! deploy failed (exit $status) after $((SECONDS - started))s — the previous build is still serving."
  log "   Output is above in this log. The next tick will retry."
  exit "$status"
fi
