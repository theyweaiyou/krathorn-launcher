const { app, BrowserWindow, ipcMain, session, BrowserView, Menu, shell, Notification } = require('electron');
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
  version: '1.0',
  author: 'theyweaiyou',
  banner: 'Features: multi-account, game notifications, shortcuts (⌘N, ⌘R, ⌘C, ⌘F, Esc). Tag releases: https://github.com/theyweaiyou/krathorn-launcher',
};

const TOPBAR_HEIGHT = 56;
const FRAME_INSET = 8;
const FOOTER_HEIGHT = 26;
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
  theme: 'midnight', sound: true, notifications: true, bannerDismissedVersion: null,
});
if (settings.theme !== 'light' && settings.theme !== 'midnight') settings.theme = 'midnight';

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

// ---------- Main window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360, height: 900, minWidth: 860, minHeight: 560,
    title: 'Krathorn Launcher',
    backgroundColor: settings.theme === 'light' ? '#f5f6f8' : '#0a0a1a',
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

  // Safety net: prevent the launcher chrome from ever navigating away from
  // itself (e.g. a stray <a href> in the footer, a link in a toast, ...).
  // Any http(s) URL is handed to the system browser instead.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https?:/i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
  });

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
  const y = TOPBAR_HEIGHT + topOffset + FRAME_INSET;
  return {
    x: FRAME_INSET, y,
    width: Math.max(0, w - FRAME_INSET * 2),
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

// ---------- Menu ----------
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Add',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('request-add-account'),
        },
        { type: 'separator' },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+C',
          click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); },
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
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
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
  return { ok: true, id, name: trimmed };
});

ipcMain.handle('rename-account', (_e, id, name) => {
  const trimmed = String(name || '').trim();
  const acct = accounts.find((a) => a.id === id);
  if (!acct || !trimmed) return { ok: false };
  acct.name = trimmed;
  writeJSON(accountsFile, accounts);
  return { ok: true };
});

ipcMain.handle('reorder-accounts', (_e, ids) => {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const next = [];
  for (const id of ids) if (byId.has(id)) { next.push(byId.get(id)); byId.delete(id); }
  for (const a of byId.values()) next.push(a);
  accounts = next;
  writeJSON(accountsFile, accounts);
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

  wc.on('dom-ready', () => {
    wc.executeJavaScript(`
      (function(){
        if (window.__krathornPatched) return;
        window.__krathornPatched = true;
        try {
          const B = window.__krathornBridge;
          if (!B) return;
          const O = window.Notification;
          if (O) {
            const W = function(t, o) { try { B.notify({ title: String(t||''), body: String((o&&o.body)||'') }); } catch(e){} return new O(t, o); };
            Object.assign(W, O);
            W.permission = O.permission;
            W.requestPermission = O.requestPermission ? O.requestPermission.bind(O) : () => Promise.resolve('granted');
            window.Notification = W;
          }
          let last = '';
          try { last = document.title; B.title(last); } catch(e){}
          setInterval(() => { try { if (document.title !== last) { last = document.title; B.title(last); } } catch(e){} }, 1000);
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

// ---------- Game notifications ----------
ipcMain.on('game-title', (_e, { accountId, title }) => {
  const m = String(title || '').match(/\((\d+)/);
  setStatus(accountId, { unread: m ? parseInt(m[1], 10) : 0 });
});

ipcMain.on('game-notification', (_e, { accountId, title, body }) => {
  if (!settings.notifications) return;
  if (mainWindow && mainWindow._activeAccountId === accountId) return;
  try {
    const n = new Notification({ title: title || 'Krathorn', body: body || '', silent: !settings.sound });
    n.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('request-switch', accountId);
      }
    });
    n.show();
  } catch (err) { log('Notification failed:', err.message); }
});