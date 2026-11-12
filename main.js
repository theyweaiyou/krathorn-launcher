const {
  app, BrowserWindow, ipcMain, session, BrowserView, Menu, shell,
  webContents, dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// ---------- Logging ----------
function log(...args) {
  const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  console.log('[Krathorn]', msg);
  try {
    const logFile = path.join(app.getPath('userData'), 'launcher.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) {}
}
process.on('uncaughtException', (err) => log('UNCAUGHT:', err.stack || err.message || String(err)));
process.on('unhandledRejection', (reason) => log('UNHANDLED REJECTION:', String(reason)));

// ---------- App info ----------
const APP_INFO = {
  version: '1.2',
  author: 'theyweaiyou',
  banner: 'New in v1.2: per-account proxy, detach-to-window, per-account zoom, mute, update checker, and hardened security. Releases: https://github.com/theyweaiyou/krathorn-launcher',
};

const TOPBAR_HEIGHT = 56;
const FRAME_INSET = 8;
const FOOTER_HEIGHT = 26;
const PANEL_WIDTH = 240;
const URL = 'https://krathorn.com/game/village';
const ALLOWED_ORIGIN = new URL(URL).origin;

// ---------- Renderer path resolution ----------
function resolveRendererFile(filename) {
  for (const p of [path.join(__dirname, 'renderer', filename), path.join(__dirname, filename)]) {
    if (fs.existsSync(p)) return p;
  }
  log('WARNING: no file found for', filename);
  return path.join(__dirname, 'renderer', filename);
}
const HTML_PATH = resolveRendererFile('index.html');
const SPLASH_PATH = resolveRendererFile('splash.html');

// ---------- Storage ----------
const userDataDir = app.getPath('userData');
const accountsFile = path.join(userDataDir, 'accounts.json');
const settingsFile = path.join(userDataDir, 'settings.json');

function migrateOldUserData() {
  try {
    const oldBase = path.join(path.dirname(userDataDir), 'krathorn-launcher');
    if (!fs.existsSync(oldBase)) return;
    fs.mkdirSync(userDataDir, { recursive: true });
    for (const [src, dst] of [
      [path.join(oldBase, 'accounts.json'), accountsFile],
      [path.join(oldBase, 'settings.json'), settingsFile],
    ]) {
      if (!fs.existsSync(dst) && fs.existsSync(src)) fs.copyFileSync(src, dst);
    }
  } catch (e) { log('migrate failed:', e.message); }
}

function readJSON(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch (e) { log('read error', file, e.message); }
  return fallback;
}
function writeJSON(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) { log('write error', file, e.message); }
}

migrateOldUserData();

// Schema-validated account list
let accounts = (readJSON(accountsFile, []) || []).filter(
  (a) => a && typeof a.id === 'string' && typeof a.name === 'string'
);
let settings = readJSON(settingsFile, {
  theme: 'midnight', sound: true, bannerDismissedVersion: null,
});
if (settings.theme !== 'light' && settings.theme !== 'midnight') settings.theme = 'midnight';
if (typeof settings.hotkeyPanelVisible !== 'boolean') settings.hotkeyPanelVisible = false;

log('startup | accounts:', accounts.length, '| theme:', settings.theme, '| v' + APP_INFO.version);

// ---------- Module state ----------
const accountViews = {};
const accountStatus = {};
const detachedWindows = new Map();  // id -> BrowserWindow
let mainWindow = null;
let splashWindow = null;
let activeAccountId = null;
let switchLock = Promise.resolve();
let topOffset = 0;
let layoutTimer = null;

// ---------- Splash ----------
function createSplash() {
  if (!fs.existsSync(SPLASH_PATH)) return;
  try {
    const w = new BrowserWindow({
      width: 420, height: 300,
      frame: false, transparent: true, resizable: false, movable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false,
      backgroundColor: '#00000000',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    splashWindow = w;
    w.loadFile(SPLASH_PATH, { query: { v: APP_INFO.version } }).catch(() => {});
    w.once('ready-to-show', () => { if (!w.isDestroyed()) w.show(); });
    w.on('closed', () => { if (splashWindow === w) splashWindow = null; });
  } catch (_) { splashWindow = null; }
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    try { splashWindow.close(); } catch (_) {}
  }
  splashWindow = null;
}

// ---------- Context menu ----------
function attachContextMenu(wc) {
  wc.on('context-menu', (_e, params) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const items = [];

    if (params.misspelledWord && params.dictionarySuggestions?.length) {
      for (const s of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      }
      items.push({ type: 'separator' });
    }

    const hasSelection = params.selectionText && params.selectionText.trim().length > 0;
    if (hasSelection) {
      items.push({ label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => wc.copy() });
    }
    if (params.isEditable) {
      items.push({ label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => wc.paste() });
    }

    if (items.length === 0) return;
    Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });
}

// ---------- Security helpers ----------
function lockNavigation(wc) {
  const allow = (u) => {
    try { return new URL(u).origin === ALLOWED_ORIGIN; } catch { return false; }
  };
  wc.on('will-navigate', (e, u) => { if (!allow(u)) e.preventDefault(); });
  wc.on('will-redirect', (e, u) => { if (!allow(u)) e.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

function installPermissionPolicy(ses) {
  const ALLOW = new Set(['notifications', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOW.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOW.has(permission));
}

// ---------- Main window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360, height: 900, minWidth: 860, minHeight: 560,
    title: 'Krathorn Launcher',
    backgroundColor: settings.theme === 'light' ? '#e8e6e0' : '#0a0a1a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    if (code === -3) return;
    log('did-fail-load:', code, desc);
    const html = `<body style="background:#0a0a1a;color:#e8e8e8;font-family:monospace;padding:40px">
      <h2 style="color:#e55">Failed to load UI (${code})</h2>
      <p>${desc}</p>
      <p style="color:#888">Check: ~/Library/Application Support/Krathorn Launcher/launcher.log</p>
    </body>`;
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
  });
  mainWindow.webContents.on('preload-error', (_e, p, err) => log('PRELOAD ERROR:', p, err.message));
  mainWindow.webContents.on('render-process-gone', (_e, d) => log('render-gone:', d.reason));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
  });

  attachContextMenu(mainWindow.webContents);
  mainWindow.loadFile(HTML_PATH).catch((err) => log('loadFile failed:', err.message));

  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore', 'move']) {
    mainWindow.on(ev, scheduleLayout);
  }
  hookEscape(mainWindow.webContents);

  mainWindow.once('ready-to-show', () => { closeSplash(); if (!mainWindow.isDestroyed()) mainWindow.show(); });

  const force = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      log('FORCE-SHOW after 4s');
      closeSplash();
      mainWindow.show();
    }
  }, 4000);

  mainWindow.on('closed', () => {
    clearTimeout(force);
    for (const id of Object.keys(accountViews)) {
      try { accountViews[id].webContents.close(); } catch {}
      delete accountViews[id];
    }
    for (const [, w] of detachedWindows) {
      try { if (!w.isDestroyed()) w.close(); } catch {}
    }
    detachedWindows.clear();
    activeAccountId = null;
    mainWindow = null;
  });
}

// ---------- Layout ----------
function hookEscape(wc) {
  wc.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' &&
        mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
  });
}

function scheduleLayout() {
  if (layoutTimer) clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => { layoutActiveView(); layoutTimer = null; }, 16);
}

function computeViewBounds() {
  const [w, h] = mainWindow.getContentSize();
  const showPanel = !!settings.hotkeyPanelVisible;
  const panelW = showPanel ? PANEL_WIDTH : 0;
  const gap = showPanel ? 8 : 0;
  const y = TOPBAR_HEIGHT + topOffset + FRAME_INSET;
  return {
    x: FRAME_INSET,
    y,
    width: Math.max(0, w - FRAME_INSET * 2 - panelW - gap),
    height: Math.max(0, h - y - FRAME_INSET - FOOTER_HEIGHT),
  };
}

function layoutActiveView() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const view = accountViews[activeAccountId];
  if (!view || view.webContents.isDestroyed()) return;
  if (mainWindow.getBrowserView() !== view) return;
  view.setBounds(computeViewBounds());
}

function notifyStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-update', accountStatus);
  }
}

function setStatus(id, patch) {
  accountStatus[id] = { ...(accountStatus[id] || {}), ...patch };
  notifyStatus();
}

// ---------- Accounts helpers ----------
function cycleAccount(dir) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (accounts.length < 2) return;
  const currentIdx = accounts.findIndex((a) => a.id === activeAccountId);
  const nextIdx = currentIdx < 0 ? 0 : (currentIdx + dir + accounts.length) % accounts.length;
  const next = accounts[nextIdx];
  if (next && next.id !== activeAccountId) {
    mainWindow.webContents.send('request-switch', next.id);
  }
}

function focusedWebContents() {
  const wc = webContents.getFocusedWebContents();
  if (wc && !wc.isDestroyed()) return wc;
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
}

// ---------- Update checker ----------
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function checkForUpdates() {
  return new Promise((resolve) => {
    const req = https.get(
      'https://api.github.com/repos/theyweaiyou/krathorn-launcher/releases/latest',
      { headers: { 'User-Agent': 'krathorn-launcher', Accept: 'application/vnd.github+json' } },
      (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const latest = String(data.tag_name || '').replace(/^v/, '');
            if (!latest) return resolve(null);
            if (compareVersions(latest, APP_INFO.version) > 0) {
              resolve({ latest, url: data.html_url, notes: data.body || '' });
            } else {
              resolve(null);
            }
          } catch (e) {
            log('update parse failed:', e.message);
            resolve(null);
          }
        });
      }
    );
    req.on('error', (e) => { log('update fetch failed:', e.message); resolve(null); });
    req.setTimeout(8000, () => { try { req.destroy(new Error('timeout')); } catch {} });
  });
}

// ---------- Menu ----------
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];

function buildMenu() {
  const accountItems = [];
  for (let i = 0; i < 9; i++) {
    const idx = i;
    accountItems.push({
      label: accounts[idx] ? `${idx + 1}. ${accounts[idx].name}` : `Account ${idx + 1}`,
      accelerator: `CmdOrCtrl+${idx + 1}`,
      enabled: !!accounts[idx],
      click: () => {
        if (accounts[idx] && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('request-switch', accounts[idx].id);
        }
      },
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: async () => {
            const u = await checkForUpdates();
            if (!mainWindow || mainWindow.isDestroyed()) return;
            if (u) {
              mainWindow.webContents.send('update-available', u);
            } else {
              dialog.showMessageBox(mainWindow, {
                type: 'info', buttons: ['OK'], title: 'Up to date',
                message: `Krathorn Launcher v${APP_INFO.version} is up to date.`,
              }).catch(() => {});
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Add Account', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('request-add-account') },
        { type: 'separator' },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+X', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); } },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => { const wc = focusedWebContents(); if (wc) wc.copy(); } },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => { const wc = focusedWebContents(); if (wc) wc.paste(); } },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => { const wc = focusedWebContents(); if (wc) wc.selectAll(); } },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (activeAccountId && accountViews[activeAccountId]) accountViews[activeAccountId].webContents.reload();
          },
        },
        { type: 'separator' },
        {
          label: 'Toggle Accounts & Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => mainWindow?.webContents.send('request-toggle-panel'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Full Screen',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(!mainWindow.isFullScreen());
          },
        },
      ],
    },
    {
      label: 'Accounts',
      submenu: [
        ...accountItems,
        { type: 'separator' },
        { label: 'Previous Account', accelerator: 'CmdOrCtrl+Left', click: () => cycleAccount(-1) },
        { label: 'Next Account', accelerator: 'CmdOrCtrl+Right', click: () => cycleAccount(1) },
        { type: 'separator' },
        { label: 'Reload All', click: () => reloadAllAccounts() },
        {
          label: 'Sound',
          submenu: [
            { label: 'Mute All', click: () => muteAllAccounts(true) },
            { label: 'Unmute All', click: () => muteAllAccounts(false) },
          ],
        },
        {
          label: 'Reset All Data…',
          click: async () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            const r = await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              buttons: ['Cancel', 'Reset All'],
              defaultId: 0,
              cancelId: 0,
              title: 'Reset all accounts',
              message: `Reset data for all ${accounts.length} accounts?`,
              detail: 'All sessions will be logged out and cookies/cache cleared.',
            });
            if (r.response !== 1) return;
            for (const id of Object.keys(accountViews)) {
              try {
                const s = session.fromPartition(`persist:krathorn-${id}`);
                await s.clearStorageData();
                await s.clearCache();
              } catch {}
            }
            for (const id of Object.keys(accountViews)) {
              const wc = accountViews[id].webContents;
              if (!wc.isDestroyed()) wc.reload();
            }
            log('reset-all completed');
          },
        },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

function reloadAllAccounts() {
  for (const id of Object.keys(accountViews)) {
    const wc = accountViews[id].webContents;
    if (!wc.isDestroyed()) wc.reload();
  }
  for (const [, w] of detachedWindows) {
    if (!w.isDestroyed()) w.webContents.reload();
  }
}

function muteAllAccounts(muted) {
  for (const id of Object.keys(accountViews)) {
    const wc = accountViews[id].webContents;
    if (!wc.isDestroyed()) wc.setAudioMuted(!!muted);
  }
  for (const [, w] of detachedWindows) {
    if (!w.isDestroyed()) w.webContents.setAudioMuted(!!muted);
  }
  for (const a of accounts) a.muted = !!muted;
  writeJSON(accountsFile, accounts);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mute-all-changed', !!muted);
  }
}

// ---------- Lifecycle ----------
app.whenReady().then(() => {
  buildMenu();
  const start = Date.now();
  createSplash();
  createWindow();

  mainWindow.once('ready-to-show', () => {
    const wait = Math.max(0, 500 - (Date.now() - start));
    setTimeout(() => {
      closeSplash();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    }, wait);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => log('whenReady FAILED:', err.stack || err.message));

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- IPC: initial state ----------
ipcMain.handle('get-initial-state', () => ({
  appInfo: APP_INFO,
  settings,
  accounts,
  statusMap: accountStatus,
  panelVisible: !!settings.hotkeyPanelVisible,
}));

// ---------- IPC: info / settings ----------
ipcMain.handle('open-external', (_e, url) => {
  try {
    if (typeof url === 'string' && /^(https?:|mailto:)/.test(url)) {
      shell.openExternal(url);
      return { ok: true };
    }
  } catch (err) { log('open-external:', err.message); }
  return { ok: false };
});

ipcMain.handle('check-update', () => checkForUpdates());

ipcMain.handle('get-settings', () => settings);

const ALLOWED_SETTINGS = new Set(['sound', 'theme', 'hotkeyPanelVisible', 'bannerDismissedVersion']);
ipcMain.handle('save-settings', (_e, s) => {
  for (const k of Object.keys(s || {})) {
    if (ALLOWED_SETTINGS.has(k)) settings[k] = s[k];
  }
  if (settings.theme !== 'light' && settings.theme !== 'midnight') settings.theme = 'midnight';
  writeJSON(settingsFile, settings);
  return { ok: true };
});

// ---------- IPC: accounts ----------
ipcMain.handle('get-accounts', () => accounts);
ipcMain.handle('get-status', () => accountStatus);

function validateProxy(proxy) {
  const p = String(proxy || '').trim();
  if (!p) return { ok: true, value: '' };
  if (!/^(https?|socks[45]?):\/\//i.test(p)) {
    return { ok: false, error: 'Proxy must start with http://, https://, socks4://, or socks5://' };
  }
  return { ok: true, value: p };
}

ipcMain.handle('add-account', (_e, name, proxy, keepActive) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: false, error: 'Name required' };
  const v = validateProxy(proxy);
  if (!v.ok) return v;
  const id = 'acc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const rec = { id, name: trimmed };
  if (v.value) rec.proxy = v.value;
  if (keepActive) rec.keepActive = true;
  accounts.push(rec);
  writeJSON(accountsFile, accounts);
  buildMenu();
  return { ok: true, id, name: trimmed };
});

ipcMain.handle('update-account', (_e, id, patch) => {
  const acct = accounts.find((a) => a.id === id);
  if (!acct) return { ok: false, error: 'Not found' };

  const proxyChanged = patch && Object.prototype.hasOwnProperty.call(patch, 'proxy');
  const keepActiveChanged = patch && Object.prototype.hasOwnProperty.call(patch, 'keepActive');
  let proxyValue = null;
  if (proxyChanged) {
    const v = validateProxy(patch.proxy);
    if (!v.ok) return v;
    proxyValue = v.value;
  }

  if (typeof patch.name === 'string') {
    const t = patch.name.trim();
    if (!t) return { ok: false, error: 'Name required' };
    acct.name = t;
  }
  if (proxyChanged) {
    if (proxyValue) acct.proxy = proxyValue;
    else delete acct.proxy;
  }
  if (keepActiveChanged) {
    if (patch.keepActive) acct.keepActive = true;
    else delete acct.keepActive;
  }
  writeJSON(accountsFile, accounts);
  buildMenu();
  if (accountViews[id] && (proxyChanged || keepActiveChanged)) {
    recreateView(id).catch((e) => log('recreateView failed:', id, e.message));
  }
  return { ok: true };
});

ipcMain.handle('rename-account', (_e, id, name) => {
  const t = String(name || '').trim();
  const acct = accounts.find((a) => a.id === id);
  if (!acct || !t) return { ok: false };
  acct.name = t;
  writeJSON(accountsFile, accounts);
  buildMenu();
  return { ok: true };
});

ipcMain.handle('reorder-accounts', (_e, ids) => {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const next = [];
  for (const id of ids) if (byId.has(id)) { next.push(byId.get(id)); byId.delete(id); }
  for (const a of byId.values()) next.push(a);
  accounts = next;
  writeJSON(accountsFile, accounts);
  buildMenu();
  return { ok: true };
});

ipcMain.handle('delete-account', async (_e, id) => {
  accounts = accounts.filter((a) => a.id !== id);
  writeJSON(accountsFile, accounts);
  if (accountViews[id]) {
    if (activeAccountId === id && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBrowserView(null);
      activeAccountId = null;
    }
    try { accountViews[id].webContents.close(); } catch {}
    delete accountViews[id];
  }
  if (detachedWindows.has(id)) {
    const w = detachedWindows.get(id);
    try { if (!w.isDestroyed()) w.close(); } catch {}
    detachedWindows.delete(id);
  }
  delete accountStatus[id];
  try {
    const s = session.fromPartition(`persist:krathorn-${id}`);
    await s.clearStorageData();
    await s.clearCache();
  } catch {}
  notifyStatus();
  buildMenu();
  return { ok: true };
});

// ---------- IPC: top offset / overlay / panel ----------
ipcMain.handle('set-top-offset', (_e, px) => {
  topOffset = Math.max(0, parseInt(px, 10) || 0);
  layoutActiveView();
  return { ok: true };
});

ipcMain.handle('hide-view', () => {
  if (mainWindow && mainWindow.getBrowserView()) mainWindow.setBrowserView(null);
  return { ok: true };
});

ipcMain.handle('show-view', () => {
  if (!mainWindow) return { ok: false };
  const view = accountViews[activeAccountId];
  if (!view || view.webContents.isDestroyed()) return { ok: false };
  if (mainWindow.getBrowserView() === view) return { ok: true };
  view.setBounds(computeViewBounds());
  view.setAutoResize({ width: true, height: true });
  mainWindow.setBrowserView(view);
  return { ok: true };
});

ipcMain.handle('set-panel-visible', (_e, visible) => {
  settings.hotkeyPanelVisible = !!visible;
  writeJSON(settingsFile, settings);
  scheduleLayout();
  return { ok: true };
});

// ---------- Game view ----------
function applySessionProxy(id) {
  const acct = accounts.find((a) => a.id === id);
  const ses = session.fromPartition(`persist:krathorn-${id}`);
  const proxy = (acct && acct.proxy ? acct.proxy : '').trim();
  ses.setProxy({ proxyRules: proxy, proxyBypassRules: '<local>' }).catch((e) =>
    log('setProxy failed:', id, e.message));
  return ses;
}

function injectTitleWatcher(wc) {
  wc.executeJavaScript(`
    (function(){
      if (window.__krathornPatched) return;
      window.__krathornPatched = true;
      try {
        const B = window.__krathornBridge;
        if (!B) return;
        let last = '';
        const emit = () => {
          try {
            if (document.title !== last) {
              last = document.title;
              B.title(last);
            }
          } catch(e){}
        };
        emit();
        new MutationObserver(emit).observe(document.head || document.documentElement, {
          childList: true, subtree: true, characterData: true
        });
        // Fallback for games that replace the head node entirely
        setInterval(emit, 5000);
      } catch(e) {}
    })();
  `).catch(() => {});
}

function installZoomShortcuts(id, wc) {
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (!(input.meta || input.control)) return;
    if (input.alt) return;
    const k = input.key;
    if (k === '=' || k === '+') { e.preventDefault(); changeZoom(id, 1); }
    else if (k === '-') { e.preventDefault(); changeZoom(id, -1); }
    else if (k === '0') { e.preventDefault(); changeZoom(id, 0); }
  });
}

function stepZoom(current, dir) {
  const cur = Number(current) || 1;
  let idx = ZOOM_STEPS.findIndex((z) => Math.abs(z - cur) < 0.01);
  if (idx < 0) {
    idx = 0;
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      if (Math.abs(ZOOM_STEPS[i] - cur) < Math.abs(ZOOM_STEPS[idx] - cur)) idx = i;
    }
  }
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + dir))];
}

function changeZoom(id, dir) {
  const acct = accounts.find((a) => a.id === id);
  if (!acct) return;
  const zoom = dir === 0 ? 1 : stepZoom(acct.zoom || 1, dir);
  acct.zoom = zoom;
  writeJSON(accountsFile, accounts);
  if (accountViews[id] && !accountViews[id].webContents.isDestroyed()) {
    try { accountViews[id].webContents.setZoomFactor(zoom); } catch {}
  }
  if (detachedWindows.has(id)) {
    const w = detachedWindows.get(id);
    if (!w.isDestroyed()) { try { w.webContents.setZoomFactor(zoom); } catch {} }
  }
}

function createGameView(id) {
  const acct = accounts.find((a) => a.id === id);
  const ses = applySessionProxy(id);
  installPermissionPolicy(ses);

  const view = new BrowserView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'game-preload.js'),
      additionalArguments: [`--account-id=${id}`],
      backgroundThrottling: !(acct && acct.keepActive),
    },
  });
  try { view.setBackgroundColor('#0d0f12'); } catch {}

  accountStatus[id] = { loading: true, title: 'Loading…', url: URL, unread: 0 };

  const wc = view.webContents;
  wc.on('did-start-loading', () => setStatus(id, { loading: true }));
  wc.on('did-stop-loading', () => setStatus(id, { loading: false }));
  wc.on('did-fail-load', (_e, code, desc) => {
    if (code === -3) return;
    setStatus(id, { loading: false, title: `Failed: ${desc}` });
  });
  wc.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return;
    log('game render gone:', id, d.reason);
    setStatus(id, { loading: true, title: 'Recovering…' });
    setTimeout(() => { try { wc.reload(); } catch {} }, 1500);
  });
  wc.on('dom-ready', () => injectTitleWatcher(wc));

  hookEscape(wc);
  attachContextMenu(wc);
  lockNavigation(wc);
  installZoomShortcuts(id, wc);

  if (acct && acct.zoom && acct.zoom !== 1) {
    try { wc.setZoomFactor(acct.zoom); } catch {}
  }
  if (acct && acct.muted) {
    try { wc.setAudioMuted(true); } catch {}
  }

  wc.loadURL(URL).catch((err) => log('game loadURL failed:', id, err.message));
  return view;
}

async function recreateView(id) {
  if (!accountViews[id]) return;
  const wasActive = activeAccountId === id;
  try { accountViews[id].webContents.close(); } catch {}
  delete accountViews[id];
  if (wasActive && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBrowserView(null);
    const newView = createGameView(id);
    accountViews[id] = newView;
    newView.setBounds(computeViewBounds());
    newView.setAutoResize({ width: true, height: true });
    mainWindow.setBrowserView(newView);
  }
  if (detachedWindows.has(id)) {
    const w = detachedWindows.get(id);
    if (!w.isDestroyed()) {
      // Reload so the new session proxy/keepActive takes effect
      try { w.webContents.reload(); } catch {}
    }
  }
}

// ---------- Detach ----------
function detachAccount(id) {
  if (detachedWindows.has(id)) {
    const w = detachedWindows.get(id);
    if (!w.isDestroyed()) { w.focus(); return; }
    detachedWindows.delete(id);
  }
  const acct = accounts.find((a) => a.id === id);
  if (!acct) return;

  const ses = applySessionProxy(id);
  installPermissionPolicy(ses);

  // Remove the docked view
  if (accountViews[id]) {
    const wasActive = activeAccountId === id;
    try { accountViews[id].webContents.close(); } catch {}
    delete accountViews[id];
    if (wasActive && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBrowserView(null);
      activeAccountId = null;
    }
  }

  const w = new BrowserWindow({
    width: 1280, height: 860,
    title: `${acct.name} — Krathorn`,
    backgroundColor: '#0d0f12',
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'game-preload.js'),
      additionalArguments: [`--account-id=${id}`],
      backgroundThrottling: !acct.keepActive,
    },
  });
  attachContextMenu(w.webContents);
  lockNavigation(w.webContents);
  installZoomShortcuts(id, w.webContents);
  hookEscape(w.webContents);
  w.webContents.on('dom-ready', () => injectTitleWatcher(w.webContents));

  if (acct.zoom && acct.zoom !== 1) { try { w.webContents.setZoomFactor(acct.zoom); } catch {} }
  if (acct.muted) { try { w.webContents.setAudioMuted(true); } catch {} }

  w.loadURL(URL).catch((err) => log('detached loadURL failed:', id, err.message));
  detachedWindows.set(id, w);
  w.on('closed', () => {
    detachedWindows.delete(id);
    notifyStatus();
  });
}

// ---------- IPC: switching (serialized) ----------
async function doSwitch(id, opts) {
  if (!mainWindow) return { ok: false };
  if (!accounts.find((a) => a.id === id)) return { ok: false, error: 'Account not found' };
  if (detachedWindows.has(id)) return { ok: false, error: 'Account is open in another window' };

  if (!accountViews[id]) accountViews[id] = createGameView(id);

  if (opts && opts.prepareOnly) {
    setStatus(id, { unread: 0 });
    return { ok: true, prepared: true };
  }

  if (mainWindow.getBrowserView() && mainWindow.getBrowserView() !== accountViews[id]) {
    mainWindow.setBrowserView(null);
  }
  const view = accountViews[id];
  view.setBounds(computeViewBounds());
  view.setAutoResize({ width: true, height: true });
  mainWindow.setBrowserView(view);
  activeAccountId = id;
  setStatus(id, { unread: 0 });
  scheduleLayout();
  return { ok: true };
}

ipcMain.handle('switch-account', (_e, id, opts = {}) => {
  switchLock = switchLock.then(() => doSwitch(id, opts)).catch((e) => {
    log('switch failed:', e.message); return { ok: false, error: e.message };
  });
  return switchLock;
});

ipcMain.handle('reload-active', () => {
  if (activeAccountId && accountViews[activeAccountId]) accountViews[activeAccountId].webContents.reload();
});

ipcMain.handle('reload-all', () => { reloadAllAccounts(); return { ok: true }; });
ipcMain.handle('mute-all', (_e, muted) => { muteAllAccounts(!!muted); return { ok: true }; });

ipcMain.handle('set-account-muted', (_e, id, muted) => {
  const acct = accounts.find((a) => a.id === id);
  if (!acct) return { ok: false };
  acct.muted = !!muted;
  writeJSON(accountsFile, accounts);
  if (accountViews[id] && !accountViews[id].webContents.isDestroyed()) {
    accountViews[id].webContents.setAudioMuted(!!muted);
  }
  if (detachedWindows.has(id)) {
    const w = detachedWindows.get(id);
    if (!w.isDestroyed()) w.webContents.setAudioMuted(!!muted);
  }
  return { ok: true, muted: !!muted };
});

ipcMain.handle('set-account-zoom', (_e, id, zoom) => {
  const acct = accounts.find((a) => a.id === id);
  if (!acct) return { ok: false };
  const z = Math.max(0.5, Math.min(2.0, Number(zoom) || 1));
  acct.zoom = z;
  writeJSON(accountsFile, accounts);
  if (accountViews[id] && !accountViews[id].webContents.isDestroyed()) {
    try { accountViews[id].webContents.setZoomFactor(z); } catch {}
  }
  if (detachedWindows.has(id)) {
    const w = detachedWindows.get(id);
    if (!w.isDestroyed()) { try { w.webContents.setZoomFactor(z); } catch {} }
  }
  return { ok: true, zoom: z };
});

ipcMain.handle('detach-account', (_e, id) => {
  detachAccount(id);
  return { ok: true };
});

ipcMain.handle('reset-account', async (_e, id) => {
  const ses = session.fromPartition(`persist:krathorn-${id}`);
  await ses.clearStorageData();
  await ses.clearCache();
  if (accountViews[id]) accountViews[id].webContents.reload();
  if (detachedWindows.has(id)) {
    const w = detachedWindows.get(id);
    if (!w.isDestroyed()) w.webContents.reload();
  }
  return { ok: true };
});

// ---------- Title watcher → unread badge (validated) ----------
ipcMain.on('game-title', (_e, payload) => {
  if (!payload || typeof payload !== 'object') return;
  const { accountId, title } = payload;
  if (!accounts.some((a) => a.id === accountId)) return;
  const m = String(title || '').match(/\((\d+)\)/);
  setStatus(accountId, { unread: m ? parseInt(m[1], 10) : 0 });
});