const { app, BrowserWindow, ipcMain, session, BrowserView, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- Logging ----------
function log(...args) {
  const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  console.log('[Krathorn]', msg);
  try {
    const logFile = path.join(app.getPath('userData'), 'launcher.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) { /* ignore */ }
}
process.on('uncaughtException', (err) => log('UNCAUGHT:', err.stack || err.message || String(err)));
process.on('unhandledRejection', (reason) => log('UNHANDLED REJECTION:', String(reason)));

// ---------- App info ----------
const APP_INFO = {
  version: '1.1',
  author: 'theyweaiyou',
  banner: 'Features: multi-account, shortcuts. Tag releases: https://github.com/theyweaiyou/krathorn-launcher.',
};

const TOPBAR_HEIGHT = 56;
const FRAME_INSET = 8;
const FOOTER_HEIGHT = 26;
const PANEL_WIDTH = 240;
const URL = 'https://krathorn.com/game/village';

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

let accounts = readJSON(accountsFile, []);
let settings = readJSON(settingsFile, {
  theme: 'midnight', sound: true, bannerDismissedVersion: null,
});
if (settings.theme !== 'light' && settings.theme !== 'midnight') settings.theme = 'midnight';
if (typeof settings.hotkeyPanelVisible !== 'boolean') settings.hotkeyPanelVisible = false;

log('startup | accounts:', accounts.length, '| theme:', settings.theme);

const accountViews = {};
const accountStatus = {};
let mainWindow = null;
let splashWindow = null;
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
    w.loadFile(SPLASH_PATH).catch(() => {});
    w.once('ready-to-show', () => { if (!w.isDestroyed()) w.show(); });
    w.on('closed', () => { if (splashWindow === w) splashWindow = null; });
  } catch (_) { splashWindow = null; }
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    try { splashWindow.close(); } catch (_) { /* ignore */ }
  }
  splashWindow = null;
}

// ---------- Context menu (right-click copy/paste) ----------
// Same behaviour for the launcher chrome and every game view: Copy appears
// when text is selected, Paste appears when the target is editable. No Cut —
// ⌘X is reserved for "Close Window" in the app menu, so showing "Cut ⌘X"
// in a popup would be misleading. No Select All either — kept minimal.
function attachContextMenu(wc) {
  wc.on('context-menu', (_e, params) => {
    const hasSelection = params.selectionText && params.selectionText.trim().length > 0;
    const items = [];

    if (hasSelection) {
      items.push({
        label: 'Copy',
        accelerator: 'CmdOrCtrl+C',
        click: () => wc.copy(),
      });
    }

    if (params.isEditable) {
      items.push({
        label: 'Paste',
        accelerator: 'CmdOrCtrl+V',
        click: () => wc.paste(),
      });
    }

    if (items.length === 0) return;
    Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });
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
    if (/^https?:/i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
  });

  attachContextMenu(mainWindow.webContents);

  mainWindow.loadFile(HTML_PATH).catch((err) => log('loadFile failed:', err.message));

  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore', 'move']) {
    mainWindow.on(ev, scheduleLayout);
  }
  hookEscape(mainWindow.webContents);

  mainWindow.once('ready-to-show', () => {
    closeSplash();
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });

  const force = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      log('FORCE-SHOW after 4s');
      closeSplash();
      mainWindow.show();
    }
  }, 4000);

  mainWindow.on('closed', () => { clearTimeout(force); mainWindow = null; });
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
  const view = accountViews[mainWindow._activeAccountId];
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
  const currentIdx = accounts.findIndex((a) => a.id === mainWindow._activeAccountId);
  const nextIdx = currentIdx < 0 ? 0 : (currentIdx + dir + accounts.length) % accounts.length;
  const next = accounts[nextIdx];
  if (next && next.id !== mainWindow._activeAccountId) {
    mainWindow.webContents.send('request-switch', next.id);
  }
}

function focusedWebContents() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const view = mainWindow.getBrowserView();
  if (view && !view.webContents.isDestroyed() && view.webContents.isFocused()) {
    return view.webContents;
  }
  return mainWindow.webContents;
}

// ---------- Menu ----------
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
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Account',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('request-add-account'),
        },
        { type: 'separator' },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+X',
          click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          click: () => { const wc = focusedWebContents(); if (wc) wc.copy(); },
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          click: () => { const wc = focusedWebContents(); if (wc) wc.paste(); },
        },
        { type: 'separator' },
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          click: () => { const wc = focusedWebContents(); if (wc) wc.selectAll(); },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const id = mainWindow?._activeAccountId;
            if (id && accountViews[id]) accountViews[id].webContents.reload();
          },
        },
        { type: 'separator' },
        {
          label: 'Toggle Full Screen',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          },
        },
      ],
    },
    {
      label: 'Accounts',
      submenu: [
        ...accountItems,
        { type: 'separator' },
        {
          label: 'Previous Account',
          accelerator: 'CmdOrCtrl+Left',
          click: () => cycleAccount(-1),
        },
        {
          label: 'Next Account',
          accelerator: 'CmdOrCtrl+Right',
          click: () => cycleAccount(1),
        },
      ],
    },
    { role: 'windowMenu' },
  ]));
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

// ---------- IPC: aggregated initial state ----------
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

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('save-settings', (_e, s) => {
  settings = { ...settings, ...s };
  if (settings.theme !== 'light' && settings.theme !== 'midnight') settings.theme = 'midnight';
  writeJSON(settingsFile, settings);
  return { ok: true };
});

// ---------- IPC: accounts ----------
ipcMain.handle('get-accounts', () => accounts);
ipcMain.handle('get-status', () => accountStatus);

ipcMain.handle('add-account', (_e, name) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: false, error: 'Name required' };
  const id = 'acc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  accounts.push({ id, name: trimmed });
  writeJSON(accountsFile, accounts);
  buildMenu();
  return { ok: true, id, name: trimmed };
});

ipcMain.handle('rename-account', (_e, id, name) => {
  const trimmed = String(name || '').trim();
  const acct = accounts.find((a) => a.id === id);
  if (!acct || !trimmed) return { ok: false };
  acct.name = trimmed;
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
    if (mainWindow && mainWindow._activeAccountId === id) {
      mainWindow.setBrowserView(null);
      mainWindow._activeAccountId = null;
    }
    try { accountViews[id].webContents.close(); } catch (_) { /* ignore */ }
    delete accountViews[id];
  }
  delete accountStatus[id];
  try { await session.fromPartition(`persist:krathorn-${id}`).clearStorageData(); } catch (_) { /* ignore */ }
  notifyStatus();
  buildMenu();
  return { ok: true };
});

// ---------- IPC: top offset (banner) ----------
ipcMain.handle('set-top-offset', (_e, px) => {
  topOffset = Math.max(0, parseInt(px, 10) || 0);
  layoutActiveView();
  return { ok: true };
});

// ---------- IPC: overlay control ----------
ipcMain.handle('hide-view', () => {
  if (mainWindow && mainWindow.getBrowserView()) mainWindow.setBrowserView(null);
  return { ok: true };
});

ipcMain.handle('show-view', () => {
  if (!mainWindow) return { ok: false };
  const view = accountViews[mainWindow._activeAccountId];
  if (!view || view.webContents.isDestroyed()) return { ok: false };
  if (mainWindow.getBrowserView() === view) return { ok: true };
  view.setBounds(computeViewBounds());
  view.setAutoResize({ width: true, height: true });
  mainWindow.setBrowserView(view);
  return { ok: true };
});

// ---------- IPC: panel visibility ----------
ipcMain.handle('set-panel-visible', (_e, visible) => {
  settings.hotkeyPanelVisible = !!visible;
  writeJSON(settingsFile, settings);
  scheduleLayout();
  return { ok: true };
});

// ---------- Game views ----------
function createGameView(id) {
  const ses = session.fromPartition(`persist:krathorn-${id}`);
  ses.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  const view = new BrowserView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'game-preload.js'),
      additionalArguments: [`--account-id=${id}`],
    },
  });
  try { view.setBackgroundColor('#0d0f12'); } catch (_) { /* ignore */ }

  accountStatus[id] = { loading: true, title: 'Loading…', url: URL, unread: 0 };

  const wc = view.webContents;
  wc.on('did-start-loading', () => setStatus(id, { loading: true }));
  wc.on('did-stop-loading', () => setStatus(id, { loading: false }));
  wc.on('did-fail-load', (_e, code, desc) => setStatus(id, { loading: false, title: `Failed: ${desc}` }));
  hookEscape(wc);
  attachContextMenu(wc);

  wc.on('dom-ready', () => {
    wc.executeJavaScript(`
      (function(){
        if (window.__krathornPatched) return;
        window.__krathornPatched = true;
        try {
          const B = window.__krathornBridge;
          if (!B) return;
          let last = '';
          try { last = document.title; B.title(last); } catch(e){}
          setInterval(() => {
            try {
              if (document.title !== last) {
                last = document.title;
                B.title(last);
              }
            } catch(e){}
          }, 1000);
        } catch(e) {}
      })();
    `).catch(() => {});
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.loadURL(URL).catch((err) => log('game loadURL failed:', id, err.message));
  return view;
}

ipcMain.handle('switch-account', async (_e, id, opts = {}) => {
  if (!mainWindow) return { ok: false };
  if (!accounts.find((a) => a.id === id)) return { ok: false, error: 'Account not found' };

  if (!accountViews[id]) accountViews[id] = createGameView(id);
  if (mainWindow.getBrowserView()) mainWindow.setBrowserView(null);

  if (opts.prepareOnly) {
    mainWindow._activeAccountId = id;
    setStatus(id, { unread: 0 });
    return { ok: true, prepared: true };
  }

  const view = accountViews[id];
  view.setBounds(computeViewBounds());
  view.setAutoResize({ width: true, height: true });

  mainWindow.setBrowserView(view);
  mainWindow._activeAccountId = id;
  setStatus(id, { unread: 0 });

  scheduleLayout();
  return { ok: true };
});

ipcMain.handle('reload-active', () => {
  const id = mainWindow?._activeAccountId;
  if (id && accountViews[id]) accountViews[id].webContents.reload();
});

ipcMain.handle('reset-account', async (_e, id) => {
  await session.fromPartition(`persist:krathorn-${id}`).clearStorageData();
  if (accountViews[id]) accountViews[id].webContents.reload();
  return { ok: true };
});

// ---------- Title watcher → unread badge ----------
ipcMain.on('game-title', (_e, { accountId, title }) => {
  const m = String(title || '').match(/\((\d+)/);
  setStatus(accountId, { unread: m ? parseInt(m[1], 10) : 0 });
});