#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BRANCH="${AUTO_PUSH_BRANCH:-main}"
REMOTE="${AUTO_PUSH_REMOTE:-origin}"
INTERVAL_SECONDS="${AUTO_PUSH_INTERVAL:-5}"
SIGNAL_FILE="${AUTO_PUSH_SIGNAL_FILE:-.deploy-now}"

# Default to the Next.js app only so local junk files (e.g. .DS_Store) are not auto-committed.
WATCH_PATHS=("$@")
if [ "${#WATCH_PATHS[@]}" -eq 0 ]; then
  WATCH_PATHS=("web")
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  echo "[auto-push] current branch is '$CURRENT_BRANCH' (expected '$BRANCH')."
  echo "[auto-push] switch branch or set AUTO_PUSH_BRANCH."
  exit 1
fi

echo "[auto-push] repo: $REPO_ROOT"
echo "[auto-push] watching paths: ${WATCH_PATHS[*]}"
echo "[auto-push] target: $REMOTE/$BRANCH"
echo "[auto-push] signal file: $SIGNAL_FILE"
echo "[auto-push] interval: ${INTERVAL_SECONDS}s"
echo "[auto-push] create signal to deploy once: touch \"$SIGNAL_FILE\""
echo "[auto-push] press Ctrl+C to stop"

while true; do
  if [ -f "$SIGNAL_FILE" ]; then
    echo "[auto-push] deploy signal detected at $(date '+%Y-%m-%d %H:%M:%S')"

    git add -A -- "${WATCH_PATHS[@]}"

    if git diff --cached --quiet; then
      echo "[auto-push] no changes in watched paths; removing signal"
      rm -f "$SIGNAL_FILE"
      sleep "$INTERVAL_SECONDS"
      continue
    fi

    COMMIT_MSG="auto: deploy $(date '+%Y-%m-%d %H:%M:%S')"
    if git commit -m "$COMMIT_MSG"; then
      git push "$REMOTE" "$BRANCH"
      echo "[auto-push] pushed: $COMMIT_MSG"
    fi
    rm -f "$SIGNAL_FILE"
  fi

  sleep "$INTERVAL_SECONDS"
done
