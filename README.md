<div align="center">

# Krathorn Launcher

**A native macOS desktop launcher for [Krathorn](https://krathorn.com) — multi-account, isolated sessions, hardened by default.**

<br/>

[![Version][badge-version]][link-releases]
[![Platform][badge-platform]][link-releases]
[![Electron][badge-electron]][link-electron]
[![License][badge-license]][link-license]
[![PRs Welcome][badge-prs]][link-contributing]

<br/>

<img src="docs/logo.png" alt="logo" width="880" />

</div>

---

## Table of Contents

- [Why Krathorn Launcher?](#why-krathorn-launcher)
- [Features](#features)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Install](#install)
- [Uninstall](#uninstall)
- [Updating](#updating)
- [FAQ](#faq)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## Why Krathorn Launcher?

Krathorn is a browser game. Like most browser games, running multiple accounts in one browser means:

- **Shared cookies** — logging into account B silently logs you out of account A.
- **Shared cache / `localStorage`** — every account sees the same UI state.
- **Silent notifications** — `window.Notification` from a tab you're not looking at gets dropped.
- **Tab sprawl** — six tabs, all titled "Krathorn", and no way to tell which one has an unread message.

Krathorn Launcher fixes all of that:

| Problem | Krathorn Launcher |
|---|---|
| ☒ Shared cookies across accounts | ☑ One isolated Chromium partition per account |
| ☒ Silent / ignored game notifications | ☑ Real macOS Notification Center alerts |
| ☒ Manual reload per tab | ☑ `⌘R` reloads only the active account |
| ☒ "Which tab is which?" | ☑ Named, reorderable account chips |
| ☒ Logging out to switch accounts | ☑ One click — sessions stay warm |
| ☒ Same IP across accounts | ☑ Optional per-account proxy (HTTP / HTTPS / SOCKS4 / SOCKS5) |
| ☒ Background tabs freeze | ☑ Optional per-account `backgroundThrottling` opt-out |
| ☒ One size fits all | ☑ Per-account zoom (50 % – 200 %) |
| ☒ Every tab plays sound | ☑ Per-account mute, plus mute-all |

---

## Features

### Multi-account

- Run **any number** of Krathorn accounts side-by-side.
- Each account gets its **own Electron session partition** (`persist:krathorn-<id>`), so cookies, cache, `localStorage`, IndexedDB, and service workers **never mix**.
- **Reorder** accounts by dragging chips in the toolbar.
- **Rename**, **edit**, **reset** (logout), or **delete** any account from its `⋯` menu.
- Deleting an account also wipes its partition and cache — no orphaned session data.
- **Detach** an account to its own window (same isolated session, separate `BrowserWindow`) — useful on a second monitor. Reattach by closing that window.

### Per-account controls

Configured from each account's `⋯` menu or the edit dialog:

- **Proxy** — `http://`, `https://`, `socks4://`, or `socks5://`. Applied to that account's partition only.
- **Zoom** — 50 % to 200 %, saved per account and reapplied on every launch. Change live with `⌘+` / `⌘−` / `⌘0` while the game is focused.
- **Mute** — silences that account's audio without affecting the others.
- **Background throttling opt-out** — for accounts that need to keep running timers while the chip is inactive. Off by default; enabling it raises CPU usage.

### Security & isolation

Every game view is loaded as untrusted remote content and defended accordingly:

- **`sandbox: true`** on all game views and detached windows. Preloads use only `contextBridge` + `ipcRenderer`, both fully supported in the sandbox.
- **Navigation lock** — `will-navigate` and `will-redirect` are blocked for any origin other than `krathorn.com`. `<webview>` injection is denied. `window.open` is forwarded to the OS browser.
- **Permission allow-list** — only `notifications` and `fullscreen` are granted. Camera, microphone, geolocation, clipboard-read, midi, HID, serial, and USB are denied by default.
- **Strict CSP** on the launcher chrome itself (`default-src 'self'`), since all launcher JS is local.
- **IPC input validation** — the `game-title` channel checks the `accountId` against the account list before writing state; the unread regex is `\((\d+)\)` so a title like "Krathorn (5 min)" doesn't create a phantom badge.

### Keyboard-first

| Shortcut | Action |
|---|---|
| `⌘N` | Add account |
| `⌘R` | Reload active account |
| `⌘X` | Close window |
| `⌘F` | Toggle fullscreen |
| `Esc` | Exit fullscreen |
| `⌘←` / `⌘→` | Previous / next account |
| `⌘1` … `⌘9` | Jump to account N |
| `⌘/` | Toggle Accounts & Shortcuts panel |
| `⌘+` / `⌘−` | Zoom active game in / out |
| `⌘0` | Reset active game zoom |
| `⌘C` / `⌘V` | Copy / paste (game view or launcher) |

### Menu actions

- **Accounts → Reload All** — reload every open game view.
- **Accounts → Sound → Mute All / Unmute All** — bulk toggle, persisted per account.
- **Accounts → Reset All Data…** — log out every account and clear cookies + cache, with a confirmation dialog.
- **Krathorn Launcher → Check for Updates…** — hits GitHub Releases and reports the latest version, or "up to date".

### Update checker

- At startup (and on demand from the menu), the launcher fetches the latest release tag from `https://api.github.com/repos/theyweaiyou/krathorn-launcher/releases/latest`.
- If a newer version exists, the top banner updates and links to the release page. Clicking the link opens your default browser.
- No data is sent — the request carries only a `User-Agent: krathorn-launcher` header. See [Private by design](#private-by-design) below.

### Two themes

- **Midnight** (default) — deep purple-navy on near-black.
- **Light** — soft off-white with the same accent.
- Theme is persisted in `settings.json` and applied instantly, no restart.

### Private by design

- **No telemetry. No analytics. No bundled trackers.**
- **One network call outside the game itself:** the update checker fetches GitHub's public Releases API (a JSON blob that's also visible in any browser). It sends only a `User-Agent: krathorn-launcher` header. Nothing is transmitted.
- Everything is stored locally under `~/Library/Application Support/Krathorn Launcher/`.
- All game views run under Electron's sandbox with `contextIsolation: true`, `nodeIntegration: false`, and navigation locked to `krathorn.com`.

---

## Screenshots

<table>
  <tr>
    <td align="center">
      <img src="docs/screenshot-launcher.png" alt="Launcher window" width="440" /><br/>
      <sub><b>Launcher window</b></sub>
    </td>
    <td align="center">
      <img src="docs/screenshot-midnight.png" alt="Midnight theme" width="440" /><br/>
      <sub><b>Midnight</b></sub>
    </td>
    <td align="center">
      <img src="docs/screenshot-light.png" alt="Light theme" width="440" /><br/>
      <sub><b>Light</b></sub>
    </td>
  </tr>
</table>

---

## Requirements

| | Minimum | Recommended |
|---|---|---|
| **OS** | macOS 11 (Big Sur) | macOS 13+ |
| **Architecture** | Intel x64 *or* Apple Silicon arm64 | Apple Silicon |
| **Node.js** *(source builds)* | ≥ 18 | ≥ 20 LTS |
| **npm** *(source builds)* | ≥ 9 | ≥ 10 |
| **Disk** | ~250 MB (app + partition data) | — |

> **Windows and Linux are not currently supported.** `main.js` uses macOS-specific paths (`~/Library/Application Support/...`) and the install step targets `/Applications`. See [FAQ](#faq).

---

## Install

### Option A — Run from source

Fastest path for trying it out or contributing.

1. Open Terminal.
2. Clone and enter the repo:

   ```bash
   git clone https://github.com/theyweaiyou/krathorn-launcher.git
   cd krathorn-launcher
  ```

3. Install dependencies (once) and launch:

   ```bash
   npm install
   npm start
   ```

### Option B — Update an existing install

1. If you already have the app installed and just want the latest code:

   ```bash
   cd krathorn-launcher
   ./update.sh --install
   ```

### Option C — Uninstall

1. The launcher ships with a clean uninstaller that removes the app, all session partitions, caches, logs, and preference plists.

   **Run**:

  ```bash
  chmod +x uninstall.sh
  ./uninstall.sh --dry-run        # preview every path that would be removed
  ./uninstall.sh                  # remove app + all user data (asks to confirm)
  ./uninstall.sh --keep-data      # back up accounts.json / settings.json to ~/Desktop first
  ./uninstall.sh --force -y       # scripted: kill the app and remove everything
  ```

2. `uninstall.sh` is idempotent — safe to run twice, and safe to run when the app is already gone. It targets macOS and Linux paths only.

---

## FAQ

<details>
<summary><b>Is this affiliated with Krathorn?</b></summary>

No. This is an independent, community-built wrapper around the Krathorn web client. It doesn't modify the game, doesn't inject anything that grants an advantage, and is provided as-is under MIT. If Krathorn's team asks it to be taken down, it will be.

</details>

<details>
<summary><b>Will I get banned for using this?</b></summary>

We hope not — but we can't guarantee it. This launcher doesn't modify network traffic, spoof the user agent (beyond a standard Chrome UA), or inject anything into the game's logic. It's structurally equivalent to keeping several browser profiles open.

**However:** multi-accounting itself may violate Krathorn's Terms of Service. Use at your own risk.

</details>

<details>
<summary><b>Does it work on Windows / Linux?</b></summary>

Not currently. `main.js` hard-codes macOS storage paths and `build.sh` targets `/Applications`. A cross-platform port would need a storage-path abstraction (Electron's `app.getPath('userData')` already handles this — the macOS-specific bits are the *installer* and *build script*). PRs welcome.

</details>

<details>
<summary><b>Why does the app take ~3 seconds to open?</b></summary>

Electron cold-start plus Chromium initialisation. The splash screen covers this. Subsequent launches are faster once the OS caches the app.

</details>

<details>
<summary><b>Can I run more than one window?</b></summary>

Yes, as of v1.2, any account can be detached to its own window from its `⋯` menu. The detached window uses the same isolated session partition, so it's the same account, just in a separate `BrowserWindow`. Close it to reattach to the docked view. The docked launcher itself remains single-window by design.
</details><details> <summary><b>Does the launcher phone home?</b></summary>

</details>

---

## Contributing

Pull requests are very welcome! For non-trivial changes, **please open an issue first** to discuss what you'd like to change — it avoids duplicated effort.

```bash
# 1. Fork the repo on GitHub, then:
git clone https://github.com/theyweaiyou/krathorn-launcher.git
cd krathorn-launcher

# 2. Branch from main
git checkout -b feat/my-new-thing

# 3. Hack, then sanity-check both paths:
npm start                # dev loop
./update.sh --build      # packaged smoke-test into dist/

# 4. Commit conventionally
git commit -m "feat: add X"
git push origin feat/my-new-thing

# 5. Open a PR
```

**Commit conventions** (loosely [Conventional Commits](https://www.conventionalcommits.org)):

| Prefix | Use for |
|---|---|
| `feat:` | New user-visible feature |
| `fix:` | Bug fix |
| `perf:` | Performance improvement |
| `refactor:` | Internal change, no user-visible effect |
| `docs:` | README, comments, screenshots |
| `chore:` | Build scripts, deps, config |

**Style notes**

- Renderer files are plain vanilla JS.
- Main process: keep IPC handlers narrow (`ipcMain.handle`), return `{ ok: boolean }` objects.
- Game views must stay `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and pass through `lockNavigation()`. PRs that weaken these will be declined.
- No new runtime dependencies unless strictly necessary — the whole point is a thin shell.

---

## Acknowledgments

- **[Electron](https://www.electronjs.org)** — the app shell.
- **[electron-packager](https://github.com/electron/electron-packager)** — zero-config macOS bundling.
- **[Krathorn](https://krathorn.com)** — the game this launcher wraps.
- Everyone who's reported a bug, sent a PR, or just tried it out.

---

## License

[MIT](LICENSE) © 2026 Krathorn

---

<div align="center">

**[back to top](#krathorn-launcher)**

<sub>Made with love for the Krathorn community. Not affiliated with Krathorn or its developers.</sub>

</div>

<!-- ============================================================
     Reference-style links — keep all URL edits here
     ============================================================ -->
[link-releases]:     https://github.com/theyweaiyou/krathorn-launcher/releases
[link-license]:      https://github.com/theyweaiyou/krathorn-launcher/blob/main/LICENSE
[link-contributing]: https://github.com/theyweaiyou/krathorn-launcher/blob/main/CONTRIBUTING.md
[link-electron]:     https://www.electronjs.org
[badge-platform]: https://img.shields.io/badge/platform-macOS%2011%2B-black?logo=apple&logoColor=white
[badge-electron]: https://img.shields.io/badge/electron-30-47848F?logo=electron&logoColor=white
[badge-license]:  https://img.shields.io/badge/license-MIT-green
[badge-prs]:      https://img.shields.io/badge/PRs-welcome-brightgreen
[badge-version]:  https://img.shields.io/badge/version-1.2-blue
