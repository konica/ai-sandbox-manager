#!/bin/bash
set -e

GITHUB_REMOTE="github"
GITHUB_URL="ssh://git@ssh.github.com:443/konica/ai-sandbox-manager.git"
GITHUB_DIR=".github"

# Ensure the github remote exists with the correct SSH-over-443 URL
if git remote get-url "$GITHUB_REMOTE" >/dev/null 2>&1; then
  git remote set-url "$GITHUB_REMOTE" "$GITHUB_URL"
else
  git remote add "$GITHUB_REMOTE" "$GITHUB_URL"
fi

echo "Pushing Bitbucket main → GitHub..."
git push "$GITHUB_REMOTE" main --force

echo "Restoring $GITHUB_DIR/ on GitHub (GitHub-only, not tracked in Bitbucket)..."
git add -f "$GITHUB_DIR/"
git commit -m "chore: GitHub Actions workflows (GitHub-only, not tracked in Bitbucket)"
git push "$GITHUB_REMOTE" main

echo "Resetting local branch so $GITHUB_DIR/ stays out of Bitbucket..."
git reset HEAD~1

echo "Sync complete. GitHub is up to date and $GITHUB_DIR/ is preserved."
