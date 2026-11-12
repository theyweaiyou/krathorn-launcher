<div align="center">

# Krathorn Launcher

**A native macOS desktop launcher for [Krathorn](https://krathorn.com) — multi-account, isolated sessions, hardened by default.**

<br/>

[![Version][badge-version]][link-releases]
[![Platform][badge-platform]][link-releases]
[![Electron][badge-electron]][link-electron]

<br/>

<img src="docs/logo.png" alt="logo" width="880" />

</div>

---

## Table of Contents

- [Why Krathorn Launcher?](#why-krathorn-launcher)
- [Whats New](#whats-new)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Install](#install)
- [FAQ](#faq)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## Why Krathorn Launcher?

Krathorn is a browser game. Like most browser games, running multiple accounts in one browser means:

- **Shared cookies** — logging into account B silently logs you out of account A.
- **Shared cache / `localStorage`** — every account sees the same UI state.
- **Tab sprawl** — six tabs, all titled "Krathorn", and no way to tell which one has an unread message.

Krathorn Launcher fixes all of that:

| Problem | Krathorn Launcher |
|---|---|
| ☒ Shared cookies across accounts | ☑ One isolated Chromium partition per account |
| ☒ Manual reload per tab | ☑ `⌘R` reloads only the active account |
| ☒ "Which tab is which?" | ☑ Named, reorderable account chips |
| ☒ Logging out to switch accounts | ☑ One click — sessions stay warm |
| ☒ Same IP across accounts | ☑ Optional per-account proxy (HTTP / HTTPS / SOCKS4 / SOCKS5) |
| ☒ Background tabs freeze | ☑ Optional per-account `backgroundThrottling` opt-out |
| ☒ One size fits all | ☑ Per-account zoom (50 % – 200 %) |
| ☒ Every tab plays sound | ☑ Per-account mute, plus mute-all |

---

## Whats New

### In v1.2

- Electron 45.3.1 and `WebContentsView` (replacing deprecated `BrowserView`).
- Sandboxed renderer processes, stricter launcher CSP, IPC sender checks, URL validation, and explicit denial of website permission prompts.
- Existing account session partition names are preserved: `persist:krathorn-<account-id>`.
- Atomic JSON writes, corrupt-configuration preservation, account-record validation, and improved failure recovery.
- Per-account loading, ready, offline, error, crashed, unresponsive, and idle statuses.
- Classic v1.1-style account tabs with a manual Add (+) action, tab close (×), account options, drag-and-drop ordering, and unread/status indicators.
- Window size, position, and maximized-state persistence.
- Standard and Memory-saving performance modes with a process/memory overview. Memory-saving closes inactive views on account switch but retains their persistent login sessions.
- Midnight/Light theme, compact interface, game zoom, startup behavior, and stable-channel automatic update checks.
- Automatic updater integration for packaged macOS builds distributed through configured GitHub Releases. A valid signed release and publishing setup are required to activate production updating.
- Installer defaults to `/Applications/Krathorn Launcher.app`.
- Improved installer backups, rollback handling, and uninstaller with dry-run and explicit purge options.

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

</details>

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
[link-electron]:     https://www.electronjs.org
[badge-platform]: https://img.shields.io/badge/platform-macOS%2011%2B-black?logo=apple&logoColor=white
[badge-electron]: https://img.shields.io/badge/electron-30-47848F?logo=electron&logoColor=white
[badge-license]:  https://img.shields.io/badge/license-MIT-green
[badge-prs]:      https://img.shields.io/badge/PRs-welcome-brightgreen
[badge-version]:  https://img.shields.io/badge/version-1.2-blue
