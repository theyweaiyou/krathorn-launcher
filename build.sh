#!/usr/bin/env bash
# Install a previously-built Krathorn Launcher .app into /Applications.
# User data and persistent account sessions remain in ~/Library/Application Support.
set -Eeuo pipefail

APP_NAME='Krathorn Launcher'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$ROOT/dist"
TARGET_APP="/Applications/${APP_NAME}.app"
USER_DATA_DIR="$HOME/Library/Application Support/${APP_NAME}"
BACKUP_ROOT="$HOME/Library/Application Support/${APP_NAME} Backups"
ARCH_ARG=''

usage() {
  cat <<USAGE
Usage: ./build.sh [arm64|x64|universal]

Install a previously-built macOS application from ./dist into /Applications.
Run ./update.sh first to build the application.

The installer preserves the existing Application Support directory and all
persistent game sessions. It backs up accounts.json and settings.json before
an upgrade.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --help|-h) usage; exit 0 ;;
    arm64|aarch64|x64|x86_64|amd64|universal) ARCH_ARG="$arg" ;;
    *) echo "Unknown argument: $arg" >&2; usage; exit 2 ;;
  esac
done

case "${ARCH_ARG:-$(uname -m)}" in
  arm64|aarch64) ARCH_MATCH='arm64' ;;
  x64|x86_64|amd64) ARCH_MATCH='x64' ;;
  universal) ARCH_MATCH='universal' ;;
  *) echo 'Unsupported architecture. Use arm64, x64, or universal.' >&2; exit 2 ;;
esac

if [[ "$(uname -s)" != 'Darwin' ]]; then
  echo 'This installer is intended to run on macOS.' >&2
  exit 1
fi
if [[ ! -d "$DIST_DIR" ]]; then
  echo "Build output not found: $DIST_DIR" >&2
  echo 'Run ./update.sh first.' >&2
  exit 1
fi

# Locate the app bundle emitted by electron-builder. Prefer requested architecture.
SRC=''
while IFS= read -r candidate; do
  [[ -d "$candidate/Contents" ]] || continue
  case "$candidate" in
    *"${ARCH_MATCH}"*) SRC="$candidate"; break ;;
  esac
  [[ -z "$SRC" ]] && SRC="$candidate"
done < <(find "$DIST_DIR" -maxdepth 4 -type d -name "${APP_NAME}.app" -print 2>/dev/null | sort)

if [[ -z "$SRC" || ! -f "$SRC/Contents/Info.plist" ]]; then
  echo "Could not locate a valid ${APP_NAME}.app in $DIST_DIR" >&2
  echo 'Run ./update.sh and inspect the build output.' >&2
  exit 1
fi

NEW_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$SRC/Contents/Info.plist" 2>/dev/null || echo unknown)
OLD_VERSION='not installed'
[[ -f "$TARGET_APP/Contents/Info.plist" ]] && OLD_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TARGET_APP/Contents/Info.plist" 2>/dev/null || echo unknown)

printf '\n%s\n' '============================================================'
printf ' %s — Installer\n' "$APP_NAME"
printf ' Version: %s -> %s\n' "$OLD_VERSION" "$NEW_VERSION"
printf ' Source:  %s\n' "$SRC"
printf ' Target:  %s\n' "$TARGET_APP"
printf '%s\n\n' '============================================================'

# Quit only processes launched from this exact app bundle path.
if pgrep -f "$TARGET_APP/Contents/MacOS/" >/dev/null 2>&1; then
  echo "==> Asking ${APP_NAME} to quit..."
  osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
  for _ in {1..20}; do
    pgrep -f "$TARGET_APP/Contents/MacOS/" >/dev/null 2>&1 || break
    sleep 0.5
  done
  if pgrep -f "$TARGET_APP/Contents/MacOS/" >/dev/null 2>&1; then
    echo '==> Closing remaining processes belonging to this app bundle...'
    pkill -TERM -f "$TARGET_APP/Contents/MacOS/" 2>/dev/null || true
    sleep 1
  fi
fi

BACKUP_PATH=''
if [[ -d "$TARGET_APP" && -d "$USER_DATA_DIR" ]]; then
  mkdir -p "$BACKUP_ROOT"
  BACKUP_PATH="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_PATH"
  for file in accounts.json settings.json; do
    [[ -f "$USER_DATA_DIR/$file" ]] && cp -p "$USER_DATA_DIR/$file" "$BACKUP_PATH/$file"
  done
  # Retain five most recent configuration backups.
  while IFS= read -r old_backup; do
    [[ -n "$old_backup" ]] && rm -rf -- "$old_backup"
  done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -print | sort -r | tail -n +6)
  echo "==> Configuration backup: $BACKUP_PATH"
fi

# macOS ships Bash 3.2. Avoid optional empty-array command prefixes when
# running with `set -u`; use this function for both normal work and rollback.
SUDO_REQUIRED=0
if [[ ! -w /Applications ]]; then
  command -v sudo >/dev/null 2>&1 || { echo 'Administrator privileges are required, but sudo was not found.' >&2; exit 1; }
  echo '==> Administrator permission is required to install into /Applications.'
  sudo -v
  SUDO_REQUIRED=1
fi

run_admin() {
  if [[ "$SUDO_REQUIRED" == '1' ]]; then
    sudo "$@"
  else
    "$@"
  fi
}

STAGING=''
INSTALL_OK=0
NEW_APP_STARTED=0
cleanup() {
  if [[ "$INSTALL_OK" != '1' ]]; then
    echo '!! Installation failed; restoring the previous application bundle if available.' >&2
    # Only remove the target if this script actually began copying the new app.
    # This avoids deleting the old app if staging/rename itself failed.
    if [[ "$NEW_APP_STARTED" == '1' && -d "$TARGET_APP" ]]; then
      run_admin rm -rf -- "$TARGET_APP" 2>/dev/null || true
    fi
    if [[ -n "$STAGING" && -d "$STAGING" && ! -e "$TARGET_APP" ]]; then
      run_admin mv -- "$STAGING" "$TARGET_APP" 2>/dev/null || true
    fi
  fi
}
trap cleanup EXIT INT TERM

if [[ -d "$TARGET_APP" ]]; then
  STAGING="${TARGET_APP}.previous-$$"
  run_admin mv -- "$TARGET_APP" "$STAGING"
fi

NEW_APP_STARTED=1
run_admin ditto "$SRC" "$TARGET_APP"
[[ -f "$TARGET_APP/Contents/Info.plist" ]] || { echo 'Install verification failed.' >&2; exit 1; }
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TARGET_APP/Contents/Info.plist" >/dev/null

if [[ -n "$STAGING" ]]; then
  run_admin rm -rf -- "$STAGING"
  STAGING=''
fi

# Do not remove Gatekeeper quarantine attributes. Distribute signed/notarized builds.
INSTALL_OK=1
trap - EXIT INT TERM

printf '\n%s\n' '============================================================'
echo 'Installation completed.'
echo "Application: $TARGET_APP"
echo "Version:     $NEW_VERSION"
[[ -n "$BACKUP_PATH" ]] && echo "Backup:      $BACKUP_PATH"
echo "Launch:      open \"$TARGET_APP\""
printf '%s\n' '============================================================'
