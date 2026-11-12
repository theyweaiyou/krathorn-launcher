#!/usr/bin/env bash
# Build (and optionally install) a signed/notarized macOS release with electron-builder.
set -Eeuo pipefail

APP_NAME='Krathorn Launcher'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
ARCH_ARG=''
NO_INSTALL=0
PUBLISH='never'

usage() {
  cat <<USAGE
Usage: ./update.sh [arm64|x64|universal] [--no-install] [--publish]

Build macOS DMG and ZIP release artifacts using electron-builder. By default,
install the built app into /Applications/Krathorn Launcher.app.

  arm64         Apple Silicon
  x64           Intel
  universal     Universal macOS build (requires macOS build host)
  --no-install  Build only; do not copy the app into /Applications (opt-out)
  --publish     Publish to the configured GitHub Releases repository (requires GH_TOKEN)

Signing and notarization are configured through the standard electron-builder
macOS environment variables. See README.md before publishing a release.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --help|-h) usage; exit 0 ;;
    --no-install) NO_INSTALL=1 ;;
    --publish) PUBLISH='always' ;;
    arm64|aarch64|x64|x86_64|amd64|universal) ARCH_ARG="$arg" ;;
    *) echo "Unknown argument: $arg" >&2; usage; exit 2 ;;
  esac
done

[[ "$(uname -s)" == 'Darwin' ]] || { echo 'Build script must run on macOS.' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'Node.js >=22 is required.' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo 'npm >=10 is required.' >&2; exit 1; }

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$NODE_MAJOR" -ge 22 ]] || { echo "Node.js 22+ required; found $(node --version)." >&2; exit 1; }
APP_VERSION="$(node -p "require('./package.json').version")"

if [[ -f package-lock.json ]]; then
  echo '==> Installing locked dependencies with npm ci'
  npm ci
else
  echo '==> First build: resolving dependencies and generating package-lock.json'
  npm install --no-audit --no-fund
fi

ARCH="${ARCH_ARG:-$(uname -m)}"
case "$ARCH" in
  arm64|aarch64) BUILDER_ARCH='arm64' ;;
  x64|x86_64|amd64) BUILDER_ARCH='x64' ;;
  universal) BUILDER_ARCH='universal' ;;
  *) echo 'Unsupported architecture.' >&2; exit 2 ;;
esac

if [[ "$PUBLISH" == 'always' && -z "${GH_TOKEN:-}" ]]; then
  echo 'GH_TOKEN is required for --publish.' >&2
  exit 1
fi

rm -rf dist
mkdir -p dist

echo '============================================================'
echo " ${APP_NAME} — v${APP_VERSION} build"
echo " Architecture: ${BUILDER_ARCH}"
echo ' Install target: /Applications/Krathorn Launcher.app (default)'
echo " Publish:      ${PUBLISH}"
echo '============================================================'

if [[ "$BUILDER_ARCH" == 'universal' ]]; then
  npx --no-install electron-builder --mac dmg zip --universal --publish "$PUBLISH"
else
  npx --no-install electron-builder --mac dmg zip --"$BUILDER_ARCH" --publish "$PUBLISH"
fi

# Locate the generated .app bundle for optional local installation.
APP_BUNDLE=''
while IFS= read -r candidate; do APP_BUNDLE="$candidate"; break; done < <(find dist -maxdepth 5 -type d -name "${APP_NAME}.app" -print 2>/dev/null | sort)
if [[ -z "$APP_BUNDLE" ]]; then
  echo 'Build artifacts were produced, but no .app bundle was found for local installation.' >&2
  echo 'Inspect ./dist for the generated artifacts.'
  [[ "$NO_INSTALL" == '1' ]] && exit 0
  exit 1
fi

echo "==> Build complete: $APP_BUNDLE"
if [[ "$NO_INSTALL" == '1' ]]; then
  echo 'Build-only mode selected; the installed application was not changed.'
  exit 0
fi
exec "$ROOT/build.sh" "$ARCH"
