# ◆ Krathorn Launcher

Multi-account desktop launcher for [Krathorn] (https://krathorn.com/game/village) built with Electron.

![Screenshot](docs/screenshot.png)

## Features

- **Multi-account** — run several Krathorn accounts side by side. Each has its own isolated session, so cookies and storage never mix.
- **Native game notifications** — in-game `window.Notification(...)` calls surface as real notifications, even when that account is not the active one.
- **Drag-to-reorder** — reorder accounts with drag & drop; order is persisted.
- **Keyboard shortcuts** — `⌘N` add account, `⌘R` reload active view, `⌘C` close window, `⌘F` toggle fullscreen, `Esc` exit fullscreen.
- **Two themes** — Midnight (dark) and Light, chosen in Settings.

## Requirements

- macOS 11 (Big Sur) or later
- Node.js 18+ *(only when building from source)*

## Installation

### Pre-built release

Download the latest `.zip` from the [Releases page](https://github.com/theyweaiyou/krathorn-launcher/releases), unzip it, and drag **Krathorn Launcher.app** into `/Applications`.

Because the app is unsigned, on first launch you may see *"Krathorn Launcher is damaged"*. Fix it with:

```bash
xattr -cr "/Applications/Krathorn Launcher.app"
