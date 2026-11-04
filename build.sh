#!/usr/bin/env bash
# ============================================================================
#  Krathorn Launcher — build & install script (macOS)
#
#  Handles both:
#    • First install  (no existing app in /Applications)
#    • Upgrade        (replaces the existing app, preserves user data)
#
#  Usage:
#    ./build.sh              # build for current Mac's arch
#    ./build.sh arm64        # Apple Silicon
#    ./build.sh x64          # Intel
#    ./build.sh universal    # fat binary (arm64 + x64)
# ============================================================================

set -euo pipefail

APP_NAME="Krathorn Launcher"
BUNDLE_ID="com.krathorn.launcher"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

TARGET_APP="/Applications/${APP_NAME}.app"
USER_DATA_DIR="$HOME/Library/Application Support/${APP_NAME}"
BACKUP_DIR="$HOME/Library/Application Support/${APP_NAME} Backups"

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
command -v node >/dev/null 2>&1 || { echo "ERROR: node is not installed"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "ERROR: npm is not installed";  exit 1; }

if ! command -v iconutil >/dev/null 2>&1; then
  echo "WARNING: iconutil not found — install Xcode CLT: xcode-select --install"
fi

# Read version from package.json (single source of truth)
APP_VERSION="1.1"
if [ -f package.json ]; then
  PKG_VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "")
  [ -n "$PKG_VERSION" ] && APP_VERSION="$PKG_VERSION"
fi

# ---------------------------------------------------------------------------
# 2. Detect install vs upgrade
# ---------------------------------------------------------------------------
INSTALL_MODE="fresh"
OLD_VERSION=""
if [ -d "$TARGET_APP" ]; then
  INSTALL_MODE="upgrade"
  OLD_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" \
                  "$TARGET_APP/Contents/Info.plist" 2>/dev/null || echo "?")
fi

echo "============================================================"
echo " ${APP_NAME}"
echo "   Mode:    $INSTALL_MODE"
echo "   Version: ${OLD_VERSION:-(not installed)}  ->  $APP_VERSION"
echo "   Target:  $TARGET_APP"
echo "============================================================"
echo ""

# ---------------------------------------------------------------------------
# 3. Quit running instance
# ---------------------------------------------------------------------------
if pgrep -f "$TARGET_APP/Contents/MacOS/" >/dev/null 2>&1; then
  echo "==> Quitting running ${APP_NAME}..."
  osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
  for _ in $(seq 1 10); do
    pgrep -f "$TARGET_APP/Contents/MacOS/" >/dev/null 2>&1 || break
    sleep 0.5
  done
  if pgrep -f "$TARGET_APP/Contents/MacOS/" >/dev/null 2>&1; then
    echo "    forcing quit..."
    pkill -f "$TARGET_APP/Contents/MacOS/" 2>/dev/null || true
    sleep 1
  fi
fi

# ---------------------------------------------------------------------------
# 4. Backup user data (upgrade only — data lives outside the .app)
# ---------------------------------------------------------------------------
BK=""
if [ "$INSTALL_MODE" = "upgrade" ] && [ -d "$USER_DATA_DIR" ]; then
  mkdir -p "$BACKUP_DIR"
  BK="$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BK"
  for f in accounts.json settings.json; do
    [ -f "$USER_DATA_DIR/$f" ] && cp "$USER_DATA_DIR/$f" "$BK/$f"
  done
  # keep last 5 backups only
  ls -1dt "$BACKUP_DIR"/*/ 2>/dev/null | tail -n +6 | xargs -I{} rm -rf {} 2>/dev/null || true
  echo "==> Backed up user data to $BK"
fi

# ---------------------------------------------------------------------------
# 5. Dependencies
# ---------------------------------------------------------------------------
if [ ! -d node_modules/electron ] || [ ! -d node_modules/electron-packager ]; then
  echo "==> Installing npm dependencies"
  npm install
fi

# ---------------------------------------------------------------------------
# 6. Icon (regenerate from icon.iconset if missing)
# ---------------------------------------------------------------------------
if [ ! -f icon.icns ] && [ -d icon.iconset ] && command -v iconutil >/dev/null 2>&1; then
  echo "==> Generating icon.icns"
  iconutil -c icns icon.iconset -o icon.icns
fi
ICON_FLAG=""
[ -f icon.icns ] && ICON_FLAG="--icon=icon.icns"

# ---------------------------------------------------------------------------
# 7. Resolve target arch
# ---------------------------------------------------------------------------
ARCH="${1:-$(uname -m)}"
case "$ARCH" in
  arm64|aarch64) PKG_ARCH="arm64";     DIST_SUFFIX="darwin-arm64";;
  x86_64|amd64)  PKG_ARCH="x64";       DIST_SUFFIX="darwin-x64";;
  universal)     PKG_ARCH="universal"; DIST_SUFFIX="darwin-universal";;
  *) echo "Unknown arch '$ARCH' (use arm64, x64, or universal)"; exit 1;;
esac

# ---------------------------------------------------------------------------
# 8. Clean previous build artifacts
# ---------------------------------------------------------------------------
rm -rf "dist/${APP_NAME}-${DIST_SUFFIX}"

# ---------------------------------------------------------------------------
# 9. Package
# ---------------------------------------------------------------------------
echo "==> Packaging for $PKG_ARCH..."
npx --no-install electron-packager . "$APP_NAME" \
  --platform=darwin \
  --arch="$PKG_ARCH" \
  --out=dist \
  --overwrite \
  $ICON_FLAG \
  --app-bundle-id="$BUNDLE_ID" \
  --app-version="$APP_VERSION" \
  --prune=true \
  --ignore="(^|/)docs(/|$)" \
  --ignore="(^|/)dist(/|$)" \
  --ignore="(^|/)build\.sh$" \
  --ignore="(^|/)icon\.iconset(/|$)" \
  --ignore="(^|/)\.git(/|$)" \
  --ignore="(^|/)\.github(/|$)" \
  --ignore="(^|/)README\.md$" \
  --ignore="(^|/)LICENSE$"

SRC="dist/${APP_NAME}-${DIST_SUFFIX}/${APP_NAME}.app"
[ -d "$SRC" ] || { echo "ERROR: build output missing at $SRC"; exit 1; }

# ---------------------------------------------------------------------------
# 10. Install / replace — atomic swap with rollback
# ---------------------------------------------------------------------------
echo "==> Installing to $TARGET_APP"
SUDO=""
if [ ! -w /Applications ]; then
  SUDO="sudo"
  echo "    (needs sudo to write to /Applications)"
fi

STAGING=""
INSTALL_OK=0
rollback() {
  if [ "$INSTALL_OK" -ne 1 ] && [ -n "$STAGING" ] && [ -d "$STAGING" ]; then
    echo ""
    echo "!! Build/install failed — rolling back to previous version"
    $SUDO rm -rf "$TARGET_APP" 2>/dev/null || true
    $SUDO mv "$STAGING" "$TARGET_APP" 2>/dev/null || true
  fi
}
trap rollback EXIT INT TERM

# Move existing app out of the way (atomic: rename, not delete)
if [ -d "$TARGET_APP" ]; then
  STAGING="${TARGET_APP}.old.$$"
  echo "==> Moving existing app to staging..."
  $SUDO mv "$TARGET_APP" "$STAGING"
fi

# Copy new build in
if ! $SUDO cp -R "$SRC" "$TARGET_APP"; then
  echo "ERROR: copy failed"
  exit 1
fi

# Verify it looks like a real .app bundle
if [ ! -f "$TARGET_APP/Contents/Info.plist" ]; then
  echo "ERROR: install verification failed (no Info.plist)"
  exit 1
fi

# Remove the old version now that the new one is verified
if [ -n "$STAGING" ]; then
  $SUDO rm -rf "$STAGING"
  STAGING=""
fi

# Clear Gatekeeper quarantine so it opens without the "damaged" dialog
xattr -dr com.apple.quarantine "$TARGET_APP" 2>/dev/null || true

INSTALL_OK=1
trap - EXIT INT TERM

# ---------------------------------------------------------------------------
# 11. Summary
# ---------------------------------------------------------------------------
NEW_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" \
                "$TARGET_APP/Contents/Info.plist" 2>/dev/null || echo "$APP_VERSION")

echo ""
echo "============================================================"
echo " Done."
echo "   Installed: $TARGET_APP"
echo "   Version:   $NEW_VERSION"
echo "   Mode:      $INSTALL_MODE"
[ -n "$BK" ] && echo "   Backup:    $BK"
echo ""
echo "   Launch:    open \"$TARGET_APP\""
echo "============================================================"