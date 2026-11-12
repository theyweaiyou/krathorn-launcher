#!/usr/bin/env bash
# update.sh — Update Krathorn Launcher from GitHub and optionally rebuild.
#
# Usage:
#   ./update.sh             pull latest + npm install
#   ./update.sh --build     pull latest + npm install + build macOS app
#   ./update.sh --install   pull latest + npm install + build + install to /Applications
#
# Fails fast if the working tree isn't a clean git checkout.

set -euo pipefail
cd "$(dirname "$0")"

REPO_URL="https://github.com/theyweaiyou/krathorn-launcher.git"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "✗ Not a git repository. Clone first:" >&2
  echo "    git clone $REPO_URL" >&2
  exit 1
fi
command -v node >/dev/null 2>&1 || { echo "✗ node not installed." >&2; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "✗ npm not installed."  >&2; exit 1; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "HEAD" ]] && BRANCH="main"

STASHED=0
if [[ -n "$(git status --porcelain)" ]]; then
  echo "⚠ Working tree has uncommitted changes — stashing."
  git stash push -u -m "update.sh auto-stash $(date +%s)"
  STASHED=1
fi

cleanup() {
  if [[ "$STASHED" == "1" ]]; then
    echo "→ Re-applying your local changes…"
    git stash pop || echo "⚠ Stash not re-applied cleanly; run 'git stash list'."
  fi
}
trap cleanup EXIT

echo "→ Fetching latest from origin…"
git fetch --prune --tags origin
git rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1 || { echo "✗ origin/$BRANCH not found." >&2; exit 1; }

echo "→ Pulling origin/$BRANCH…"
git pull --ff-only origin "$BRANCH"

echo "→ Installing npm dependencies…"
npm install --no-audit --no-fund

ARCH="$(uname -m)"
case "${1:-}" in
  --build)
    case "$ARCH" in
      arm64)  npm run build:mac ;;
      x86_64) npm run build:mac-intel ;;
      *)      echo "✗ Unsupported arch: $ARCH" >&2; exit 1 ;;
    esac
    echo "✓ Build complete. App in ./dist/"
    ;;
  --install)
    case "$ARCH" in
      arm64)  npm run install:mac ;;
      x86_64) npm run install:mac-intel ;;
      *)      echo "✗ Unsupported arch: $ARCH" >&2; exit 1 ;;
    esac
    echo "✓ Installed to /Applications/Krathorn Launcher.app"
    ;;
  "")
    echo "✓ Update complete. Run 'npm start' to launch."
    ;;
  *)
    echo "✗ Unknown option: $1" >&2
    echo "Usage: $0 [--build|--install]" >&2
    exit 1
    ;;
esac