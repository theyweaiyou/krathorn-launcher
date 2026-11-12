#!/usr/bin/env bash
# uninstall.sh — Cleanly uninstall Krathorn Launcher.
#
# Usage:
#   ./uninstall.sh                 remove app + all user data (asks to confirm)
#   ./uninstall.sh --dry-run       show what would be removed, touch nothing
#   ./uninstall.sh --yes | -y      skip the confirmation prompt
#   ./uninstall.sh --keep-data     remove app + caches, keep accounts.json/settings.json
#   ./uninstall.sh --force         kill the running app instead of aborting
#
# Idempotent: safe to run when the app is already gone.
# Does NOT touch this source checkout (node_modules/, dist/, the repo itself).

set -euo pipefail

# ---------- Flags ----------
DRY_RUN=0
ASSUME_YES=0
KEEP_DATA=0
FORCE_KILL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=1 ;;
    --yes|-y)    ASSUME_YES=1 ;;
    --keep-data) KEEP_DATA=1 ;;
    --force)     FORCE_KILL=1 ;;
    -h|--help)   sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

OS="$(uname -s)"
APP_NAME="Krathorn Launcher"
BUNDLE_ID="com.krathorn.launcher"

# ---------- Path tables ----------
APP_PATHS=()
DATA_PATHS=()
CACHE_PATHS=()
PREF_FILES=()

case "$OS" in
  Darwin)
    APP_PATHS+=(
      "/Applications/$APP_NAME.app"
      "$HOME/Applications/$APP_NAME.app"
    )
    DATA_PATHS+=(
      "$HOME/Library/Application Support/$APP_NAME"
      "$HOME/Library/Application Support/krathorn-launcher"     # migrated-from
      "$HOME/Library/Saved Application State/$BUNDLE_ID.savedState"
      "$HOME/Library/WebKit/$BUNDLE_ID"
      "$HOME/Library/HTTPStorages/$BUNDLE_ID"
      "$HOME/Library/Containers/$BUNDLE_ID"                     # harmless if absent
    )
    CACHE_PATHS+=(
      "$HOME/Library/Caches/$APP_NAME"
      "$HOME/Library/Caches/$BUNDLE_ID"
      "$HOME/Library/Logs/$APP_NAME"
    )
    PREF_FILES+=(
      "$HOME/Library/Preferences/$BUNDLE_ID.plist"
      "$HOME/Library/HTTPStorages/$BUNDLE_ID.binarycookies"
      "$HOME/Library/Cookies/$BUNDLE_ID.binarycookies"
    )
    ;;
  Linux)
    APP_PATHS+=(
      "$HOME/.local/share/applications/krathorn-launcher.desktop"
      "/opt/$APP_NAME"
    )
    DATA_PATHS+=(
      "$HOME/.config/$APP_NAME"
      "$HOME/.config/krathorn-launcher"
      "$HOME/.local/share/$APP_NAME"
      "$HOME/.local/share/krathorn-launcher"
    )
    CACHE_PATHS+=(
      "$HOME/.cache/$APP_NAME"
      "$HOME/.cache/krathorn-launcher"
    )
    ;;
  *)
    echo "✗ Unsupported OS: $OS (this script targets macOS and Linux)" >&2
    exit 1
    ;;
esac

# ---------- Is it running? ----------
find_running_pids() {
  local pattern pid cmd
  case "$OS" in
    Darwin) pattern="$APP_NAME.app/Contents/MacOS/" ;;
    Linux)  pattern="$APP_NAME" ;;
  esac
  while read -r pid; do
    [[ -z "$pid" || "$pid" == "$$" ]] && continue
    cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
    [[ "$cmd" == *"uninstall.sh"* ]] && continue
    echo "$pid"
  done < <(pgrep -f "$pattern" 2>/dev/null || true)
}

RUNNING_PIDS="$(find_running_pids || true)"
if [[ -n "$RUNNING_PIDS" ]]; then
  echo "⚠ $APP_NAME appears to be running (PIDs: $(echo "$RUNNING_PIDS" | tr '\n' ' '))."
  if [[ "$FORCE_KILL" == "1" ]]; then
    echo "→ Sending TERM…"
    # shellcheck disable=SC2086
    kill -TERM $RUNNING_PIDS 2>/dev/null || true
    sleep 1
    STILL="$(find_running_pids || true)"
    if [[ -n "$STILL" ]]; then
      echo "→ Still running; sending KILL…"
      # shellcheck disable=SC2086
      kill -KILL $STILL 2>/dev/null || true
    fi
  else
    echo "  Quit the app and re-run, or pass --force to kill it." >&2
    exit 1
  fi
fi

# ---------- Plan ----------
print_plan() {
  local p any=0
  echo "Will remove:"
  for p in "${APP_PATHS[@]}" "${DATA_PATHS[@]}" "${CACHE_PATHS[@]}" "${PREF_FILES[@]}"; do
    if [[ -e "$p" || -L "$p" ]]; then
      printf '  • %s\n' "$p"
      any=1
    fi
  done
  [[ "$any" == "0" ]] && echo "  (nothing found — already uninstalled?)"

  if [[ "$KEEP_DATA" == "1" ]]; then
    echo ""
    echo "Will preserve a copy of:"
    case "$OS" in
      Darwin) echo "  • $HOME/Library/Application Support/$APP_NAME/{accounts.json,settings.json}" ;;
      Linux)  echo "  • $HOME/.config/$APP_NAME/{accounts.json,settings.json}" ;;
    esac
  fi
}

if [[ "$DRY_RUN" == "1" ]]; then
  echo "── Dry run ──"
  print_plan
  echo ""
  echo "(nothing removed)"
  exit 0
fi

# ---------- Confirm ----------
if [[ "$ASSUME_YES" != "1" ]]; then
  print_plan
  echo ""
  if [[ ! -t 0 ]]; then
    echo "✗ Not a TTY; pass --yes to confirm non-interactively." >&2
    exit 1
  fi
  read -r -p "Proceed with uninstall? [y/N] " reply
  case "$reply" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

# ---------- Helpers ----------
removed=0
skipped=0
failed=0

remove_path() {
  local p="$1"
  if [[ ! -e "$p" && ! -L "$p" ]]; then
    skipped=$((skipped+1)); return 0
  fi
  if rm -rf "$p" 2>/dev/null; then
    printf '✓ removed %s\n' "$p"
    removed=$((removed+1))
  else
    printf '✗ failed to remove %s\n' "$p" >&2
    failed=$((failed+1))
  fi
}

# ---------- Preserve data if requested ----------
BACKUP_DIR=""
if [[ "$KEEP_DATA" == "1" ]]; then
  case "$OS" in
    Darwin) SRC_DIR="$HOME/Library/Application Support/$APP_NAME" ;;
    Linux)  SRC_DIR="$HOME/.config/$APP_NAME" ;;
  esac
  if [[ -d "$SRC_DIR" ]]; then
    BACKUP_DIR="$HOME/Desktop/Krathorn-Launcher-Backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    for f in accounts.json settings.json; do
      if [[ -f "$SRC_DIR/$f" ]]; then
        cp -p "$SRC_DIR/$f" "$BACKUP_DIR/" && \
          printf '✓ preserved %s → %s\n' "$f" "$BACKUP_DIR/$f"
      fi
    done
    echo ""
  fi
fi

# ---------- Remove ----------
echo "Removing…"
for p in "${APP_PATHS[@]}" "${DATA_PATHS[@]}" "${CACHE_PATHS[@]}" "${PREF_FILES[@]}"; do
  remove_path "$p"
done

# Extra sweep for the whole userData tree, in case a subdir was added later.
case "$OS" in
  Darwin)
    remove_path "$HOME/Library/Application Support/$APP_NAME"
    remove_path "$HOME/Library/Application Support/krathorn-launcher"
    ;;
  Linux)
    remove_path "$HOME/.config/$APP_NAME"
    remove_path "$HOME/.config/krathorn-launcher"
    ;;
esac

# ---------- Summary ----------
echo ""
echo "── Summary ──"
echo "  removed: $removed"
echo "  skipped: $skipped (already absent)"
echo "  failed:  $failed"
if [[ -n "$BACKUP_DIR" ]]; then
  echo ""
  echo "Preserved: $BACKUP_DIR"
  echo "  To restore after reinstall: copy accounts.json / settings.json into"
  case "$OS" in
    Darwin) echo "  $HOME/Library/Application Support/$APP_NAME/" ;;
    Linux)  echo "  $HOME/.config/$APP_NAME/" ;;
  esac
fi
if [[ "$failed" -gt 0 ]]; then
  echo ""
  echo "Some paths could not be removed. Check permissions, or re-run with sudo if appropriate." >&2
  exit 1
fi
echo ""
echo "✓ Krathorn Launcher uninstalled."