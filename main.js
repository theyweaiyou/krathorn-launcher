'use strict';

const {
  app, BrowserWindow, WebContentsView, ipcMain, session, Menu, shell,
  screen, dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { initUpdater } = require('./modules/updater');

const appStart = Date.now();
const APP_INFO = {
  version: app.getVersion(),
  author: 'theyweaiyou',
  banner: 'Krathorn Launcher v1.2 — Enhanced multi-account experience. Releases: https://github.com/theyweaiyou/krathorn-launcher',
};

const TOPBAR_HEIGHT = 56;
const FRAME_INSET = 8;
const FOOTER_HEIGHT = 26;
const PANEL_WIDTH = 240;
const GAME_URL = 'https://krathorn.com/game/village';
const HTML_PATH = path.join(__dirname, 'renderer', 'index.html');
const SPLASH_PATH = path.join(__dirname, 'renderer', 'splash.html');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const GAME_PRELOAD_PATH = path.join(__dirname, 'game-preload.js');

const userDataDir = app.getPath('userData');
const accountsFile = path.join(userDataDir, 'accounts.json');
const settingsFile = path.join(userDataDir, 'settings.json');
const DEFAULT_SETTINGS = Object.freeze({
  theme: 'midnight',
  sound: true,
  bannerDismissedVersion: null,
  hotkeyPanelVisible: false,
  startupBehavior: 'restore-last',
  lastActiveAccountId: null,
  performanceMode: 'standard',
  compactMode: false,
  gameZoomFactor: 1,
  autoUpdateEnabled: true,
});

// ---------- Logging and durable JSON storage ----------
function log(...args) {
  const msg = args.map((value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'object' && value !== null) {
      try { return JSON.stringify(value); } catch (_) { return '[unserializable object]'; }
    }
    return String(value);
  }).join(' ');
  console.log('[Krathorn]', msg);
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.appendFileSync(path.join(userDataDir, 'launcher.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) { /* Logging must never crash the application. */ }
}

process.on('uncaughtException', (error) => log('UNCAUGHT EXCEPTION:', error));
process.on('unhandledRejection', (reason) => log('UNHANDLED REJECTION:', reason));

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    log('JSON read failed:', path.basename(file), error.message);
    try {
      const backup = `${file}.corrupt-${Date.now()}`;
      fs.copyFileSync(file, backup);
      log('Corrupt JSON preserved at:', backup);
    } catch (copyError) { log('Could not preserve corrupt JSON:', copyError.message); }
    return fallback;
  }
}

function writeJSON(file, data) {
  const temp = `${file}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(temp, 'w', 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
    return true;
  } catch (error) {
    log('JSON write failed:', path.basename(file), error.message);
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) { /* ignore */ }
    return false;
  }
}

function validAccountId(id) {
  return typeof id === 'string' && /^acc-[a-z0-9-]{5,80}$/i.test(id);
}
function sanitizeAccount(account) {
  if (!account || !validAccountId(account.id)) return null;
  const name = String(account.name || '').trim().slice(0, 48);
  if (!name) return null;
  return {
    id: account.id,
    name,
  };
}
function sanitizeSettings(raw) {
  const next = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  next.theme = next.theme === 'light' ? 'light' : 'midnight';
  next.sound = next.sound !== false;
  next.hotkeyPanelVisible = next.hotkeyPanelVisible === true;
  next.startupBehavior = ['restore-last', 'first-account', 'empty'].includes(next.startupBehavior)
    ? next.startupBehavior : DEFAULT_SETTINGS.startupBehavior;
  next.lastActiveAccountId = validAccountId(next.lastActiveAccountId) ? next.lastActiveAccountId : null;
  next.performanceMode = ['standard', 'memory-saving'].includes(next.performanceMode)
    ? next.performanceMode : 'standard';
  next.compactMode = next.compactMode === true;
  next.gameZoomFactor = Math.min(1.25, Math.max(0.75, Number(next.gameZoomFactor) || 1));
  next.autoUpdateEnabled = next.autoUpdateEnabled !== false;
  // Remove settings retired during earlier v1.2 development iterations while preserving supported preferences.
  delete next.notificationsEnabled;
  delete next.idleUnloadMinutes;
  delete next.accentColor;
  delete next.updateChannel;
  return next;
}

let accountsRaw = readJSON(accountsFile, []);
let accounts = Array.isArray(accountsRaw) ? accountsRaw.map(sanitizeAccount).filter(Boolean) : [];
let settings = sanitizeSettings(readJSON(settingsFile, DEFAULT_SETTINGS));
writeJSON(accountsFile, accounts);
writeJSON(settingsFile, settings);
log('startup | version:', APP_INFO.version, '| accounts:', accounts.length, '| theme:', settings.theme);

// ---------- Runtime state ----------
const accountViews = Object.create(null);
const accountStatus = Object.create(null);
const gameContentsToAccount = new Map();
let mainWindow = null;
let splashWindow = null;
let activeAccountId = null;
let attachedView = null;
let topOffset = 0;
let layoutTimer = null;
let windowSaveTimer = null;
let updater = null;

function persistSettings(patch = {}) {
  settings = sanitizeSettings({ ...settings, ...patch });
  writeJSON(settingsFile, settings);
  return settings;
}
function persistAccounts() {
  accounts = accounts.map(sanitizeAccount).filter(Boolean);
  writeJSON(accountsFile, accounts);
}
function isTrustedLauncher(event) {
  return !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
}
function registerLauncherHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedLauncher(event)) {
      log('Rejected IPC from untrusted sender:', channel, event.sender?.id);
      return { ok: false, error: 'Unauthorized IPC sender' };
    }
    try { return await handler(event, ...args); }
    catch (error) {
      log('IPC failure:', channel, error);
      return { ok: false, error: 'Operation failed' };
    }
  });
}
function safeExternalUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return url.toString();
  } catch (_) { /* invalid URL */ }
  return null;
}
function isAllowedEmbeddedUrl(value) {
  try { return new URL(value).protocol === 'https:'; }
  catch (_) { return false; }
}

// ---------- Window geometry ----------
function savedWindowBounds() {
  const saved = settings.windowBounds;
  const fallback = { width: 1360, height: 900 };
  if (!saved || typeof saved !== 'object') return fallback;
  const width = Math.min(2600, Math.max(860, Number(saved.width) || fallback.width));
  const height = Math.min(1800, Math.max(560, Number(saved.height) || fallback.height));
  const x = Number.isFinite(Number(saved.x)) ? Number(saved.x) : undefined;
  const y = Number.isFinite(Number(saved.y)) ? Number(saved.y) : undefined;
  if (x === undefined || y === undefined) return { width, height };
  const visible = screen.getAllDisplays().some((display) => {
    const b = display.workArea;
    return x < b.x + b.width && x + width > b.x && y < b.y + b.height && y + height > b.y;
  });
  return visible ? { x, y, width, height } : { width, height };
}
function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
  if (mainWindow.isMaximized()) {
    persistSettings({ windowBounds: { ...(settings.windowBounds || {}), maximized: true } });
    return;
  }
  const [x, y] = mainWindow.getPosition();
  const [width, height] = mainWindow.getSize();
  persistSettings({ windowBounds: { x, y, width, height, maximized: false } });
}
function scheduleWindowSave() {
  if (windowSaveTimer) clearTimeout(windowSaveTimer);
  windowSaveTimer = setTimeout(() => { windowSaveTimer = null; saveWindowState(); }, 350);
}

// ---------- Splash ----------
function createSplash() {
  if (!fs.existsSync(SPLASH_PATH)) return;
  try {
    splashWindow = new BrowserWindow({
      width: 420, height: 300, center: true, frame: false, transparent: true,
      resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true,
      show: false, backgroundColor: '#00000000',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    splashWindow.loadFile(SPLASH_PATH, { query: { v: APP_INFO.version } }).catch((error) => log('Splash load failed:', error.message));
    splashWindow.once('ready-to-show', () => { if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show(); });
    splashWindow.on('closed', () => { splashWindow = null; });
  } catch (error) { log('Splash creation failed:', error.message); splashWindow = null; }
}
function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    try { splashWindow.close(); } catch (_) { /* ignore */ }
  }
  splashWindow = null;
}

// ---------- Window and view layout ----------
function computeViewBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: 0, y: 0, width: 0, height: 0 };
  const [width, height] = mainWindow.getContentSize();
  const panelWidth = settings.hotkeyPanelVisible ? PANEL_WIDTH : 0;
  const panelGap = settings.hotkeyPanelVisible ? 8 : 0;
  const y = TOPBAR_HEIGHT + topOffset + FRAME_INSET;
  return {
    x: FRAME_INSET,
    y,
    width: Math.max(0, width - FRAME_INSET * 2 - panelWidth - panelGap),
    height: Math.max(0, height - y - FRAME_INSET - FOOTER_HEIGHT),
  };
}
function attachView(view) {
  if (!mainWindow || mainWindow.isDestroyed() || !view || view.webContents.isDestroyed()) return false;
  if (attachedView && attachedView !== view) {
    try { mainWindow.contentView.removeChildView(attachedView); } catch (_) { /* already detached */ }
  }
  if (attachedView !== view) {
    try { mainWindow.contentView.addChildView(view); } catch (error) { log('Could not attach game view:', error.message); return false; }
  }
  attachedView = view;
  view.setBounds(computeViewBounds());
  return true;
}
function detachView() {
  if (mainWindow && !mainWindow.isDestroyed() && attachedView) {
    try { mainWindow.contentView.removeChildView(attachedView); } catch (_) { /* already detached */ }
  }
  attachedView = null;
}
function layoutActiveView() {
  if (!mainWindow || mainWindow.isDestroyed() || !attachedView || attachedView.webContents.isDestroyed()) return;
  attachedView.setBounds(computeViewBounds());
}
function scheduleLayout() {
  if (layoutTimer) clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => { layoutActiveView(); layoutTimer = null; }, 16);
}
function hookEscape(webContents) {
  webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
      event.preventDefault();
    }
  });
}
function attachContextMenu(webContents) {
  webContents.on('context-menu', (_event, params) => {
    const items = [];
    if (params.selectionText?.trim()) items.push({ label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => webContents.copy() });
    if (params.isEditable) items.push({ label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => webContents.paste() });
    if (!items.length) return;
    const win = BrowserWindow.fromWebContents(webContents) || mainWindow;
    if (win) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

function createWindow() {
  const bounds = savedWindowBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 860,
    minHeight: 560,
    title: 'Krathorn Launcher',
    backgroundColor: settings.theme === 'light' ? '#e8e6e0' : '#0a0a1a',
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });
  if (settings.windowBounds?.maximized === true) mainWindow.maximize();

  const win = mainWindow;
  let rendererRecoveryAttempted = false;
  win.webContents.on('preload-error', (_event, preloadPath, error) => log('PRELOAD ERROR:', preloadPath, error.message));
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      log('Launcher UI navigation failed:', code, description, url);
      dialog.showErrorBox('Krathorn Launcher could not load', `${description} (error ${code})\n\nCheck launcher.log in ~/Library/Application Support/Krathorn Launcher/.`);
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    log('Launcher renderer gone:', details);
    if (!rendererRecoveryAttempted && mainWindow === win && !win.isDestroyed()) {
      rendererRecoveryAttempted = true;
      setTimeout(() => { if (mainWindow === win && !win.isDestroyed()) win.loadFile(HTML_PATH).catch((error) => log('Launcher UI recovery failed:', error.message)); }, 500);
    } else {
      dialog.showErrorBox('Krathorn Launcher stopped', 'The launcher interface stopped unexpectedly. Reopen the app. Your saved accounts and sessions are preserved.');
    }
  });
  win.webContents.on('unresponsive', () => log('Launcher interface is unresponsive'));
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    const safe = safeExternalUrl(url);
    if (safe) shell.openExternal(safe).catch((error) => log('External navigation failed:', error.message));
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    const safe = safeExternalUrl(url);
    if (safe) shell.openExternal(safe).catch((error) => log('External window failed:', error.message));
    return { action: 'deny' };
  });
  attachContextMenu(win.webContents);
  hookEscape(win.webContents);
  win.loadFile(HTML_PATH).catch((error) => log('Launcher UI load failed:', error.message));

  for (const eventName of ['resize', 'maximize', 'unmaximize', 'restore', 'move']) {
    win.on(eventName, () => { scheduleLayout(); scheduleWindowSave(); });
  }
  win.on('enter-full-screen', scheduleLayout);
  win.on('leave-full-screen', () => { scheduleLayout(); scheduleWindowSave(); });
  win.once('ready-to-show', () => {
    const wait = Math.max(0, 450 - (Date.now() - appStart));
    setTimeout(() => {
      closeSplash();
      if (mainWindow === win && !win.isDestroyed()) win.show();
    }, wait);
  });
  const fallback = setTimeout(() => {
    if (mainWindow === win && !win.isDestroyed() && !win.isVisible()) {
      log('Showing launcher after readiness timeout');
      closeSplash();
      win.show();
    }
  }, 5000);
  win.on('close', () => saveWindowState());
  win.on('closed', () => {
    clearTimeout(fallback);
    if (mainWindow === win) mainWindow = null;
    attachedView = null;
    destroyAllGameViews();
    activeAccountId = null;
  });
}

// ---------- Account status and view lifecycle ----------
function notifyStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('status-update', { ...accountStatus });
}
function setStatus(id, patch) {
  if (!validAccountId(id)) return;
  const previous = accountStatus[id] || {};
  accountStatus[id] = { ...previous, ...patch };
  notifyStatus();
}
function destroyGameView(id, reason = 'idle') {
  const view = accountViews[id];
  if (!view) return;
  if (attachedView === view) detachView();
  gameContentsToAccount.delete(view.webContents.id);
  try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch (error) { log('View disposal failed:', id, error.message); }
  delete accountViews[id];
  setStatus(id, { loading: false, state: 'idle', detail: reason, title: 'Not loaded' });
}
function destroyAllGameViews() {
  for (const id of Object.keys(accountViews)) destroyGameView(id, 'window-closed');
}
function applyPerformancePolicy() {
  // Memory-saving mode closes inactive WebContents immediately after a switch.
  // Persistent session partitions remain untouched, so cookies and logins survive.
  if (settings.performanceMode !== 'memory-saving') return;
  for (const id of Object.keys(accountViews)) {
    if (id !== activeAccountId) destroyGameView(id, 'memory-saving');
  }
}
function applyZoom(view) {
  try { view.webContents.setZoomFactor(settings.gameZoomFactor); } catch (error) { log('Zoom apply failed:', error.message); }
}

// ---------- Accounts and menus ----------
function findAccount(id) { return accounts.find((account) => account.id === id) || null; }
function cycleAccount(direction) {
  if (!mainWindow || mainWindow.isDestroyed() || accounts.length < 2) return;
  const index = accounts.findIndex((account) => account.id === activeAccountId);
  const nextIndex = index < 0 ? 0 : (index + direction + accounts.length) % accounts.length;
  const next = accounts[nextIndex];
  if (next) mainWindow.webContents.send('request-switch', next.id);
}
function focusedWebContents() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  if (attachedView && !attachedView.webContents.isDestroyed() && attachedView.webContents.isFocused()) return attachedView.webContents;
  return mainWindow.webContents;
}
function buildMenu() {
  const accountItems = [];
  for (let index = 0; index < Math.min(9, accounts.length); index += 1) {
    const account = accounts[index];
    accountItems.push({
      label: `${index + 1}. ${account.name}`,
      accelerator: `CmdOrCtrl+${index + 1}`,
      click: () => mainWindow?.webContents.send('request-switch', account.id),
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [
      { label: 'Add Account', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('request-add-account') },
      { type: 'separator' },
      { label: 'Close Window', accelerator: 'CmdOrCtrl+X', click: () => mainWindow?.close() },
    ] },
    { label: 'Edit', submenu: [
      { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => activeAccountId && accountViews[activeAccountId]?.webContents.reload() },
      { type: 'separator' },
      { label: 'Toggle Full Screen', accelerator: 'CmdOrCtrl+F', click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()) },
    ] },
    { label: 'Accounts', submenu: [
      ...accountItems,
      { type: 'separator' },
      { label: 'Previous Account', accelerator: 'CmdOrCtrl+Left', click: () => cycleAccount(-1) },
      { label: 'Next Account', accelerator: 'CmdOrCtrl+Right', click: () => cycleAccount(1) },
    ] },
    { role: 'windowMenu' },
  ]));
}

// ---------- Permission policy ----------
function configureSessionPermissions(ses) {
  // The launcher does not use desktop notifications or other website permission prompts.
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

// ---------- Game WebContentsView ----------
function createGameView(id) {
  const ses = session.fromPartition(`persist:krathorn-${id}`); // Preserve v1.1 partitions.
  configureSessionPermissions(ses);
  ses.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: GAME_PRELOAD_PATH,
      additionalArguments: [`--account-id=${id}`],
      devTools: !app.isPackaged,
    },
  });
  const wc = view.webContents;
  try { wc.setZoomMode('isolated'); } catch (_) { /* optional on older Electron builds */ }
  gameContentsToAccount.set(wc.id, id);
  setStatus(id, { loading: true, state: 'loading', title: 'Loading…', url: GAME_URL, unread: 0, error: null });
  wc.on('did-start-loading', () => setStatus(id, { loading: true, state: 'loading', error: null }));
  wc.on('did-stop-loading', () => {
    const priorState = accountStatus[id]?.state;
    const keepFailure = ['offline', 'error', 'crashed', 'unresponsive'].includes(priorState);
    setStatus(id, { loading: false, state: keepFailure ? priorState : 'ready' });
  });
  wc.on('did-finish-load', () => {
    applyZoom(view);
    setStatus(id, { loading: false, state: 'ready', title: wc.getTitle() || 'Krathorn Village', url: wc.getURL(), error: null });
  });
  wc.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    const offline = [-2, -6, -7, -21, -105, -106].includes(code);
    setStatus(id, { loading: false, state: offline ? 'offline' : 'error', error: `${description} (${code})`, title: offline ? 'Connection unavailable' : 'Page load failed', url: validatedURL });
    log('Game load failed:', id, code, description, validatedURL);
  });
  wc.on('render-process-gone', (_event, details) => {
    log('Game renderer exited:', id, details);
    setStatus(id, { loading: false, state: 'crashed', error: details.reason || 'Renderer process ended', title: 'Renderer stopped' });
  });
  wc.on('unresponsive', () => setStatus(id, { state: 'unresponsive', error: 'Page is not responding' }));
  wc.on('responsive', () => setStatus(id, { state: 'ready', error: null }));
  wc.on('page-title-updated', (_event, title) => setStatus(id, { title: title || 'Krathorn Village' }));
  wc.on('will-navigate', (event, url) => {
    if (isAllowedEmbeddedUrl(url)) return;
    event.preventDefault();
    const safe = safeExternalUrl(url);
    if (safe) shell.openExternal(safe).catch((error) => log('Game external navigation failed:', error.message));
  });
  wc.setWindowOpenHandler(({ url }) => {
    const safe = safeExternalUrl(url);
    if (safe) shell.openExternal(safe).catch((error) => log('Game popup failed:', error.message));
    return { action: 'deny' };
  });
  hookEscape(wc);
  attachContextMenu(wc);
  wc.on('dom-ready', () => {
    wc.executeJavaScript(`(() => {
      if (window.__krathornTitleObserverInstalled) return;
      window.__krathornTitleObserverInstalled = true;
      const sendTitle = () => { try { window.__krathornBridge?.title(document.title || ''); } catch (_) {} };
      sendTitle();
      const title = document.querySelector('title');
      if (title) new MutationObserver(sendTitle).observe(title, { childList: true, subtree: true, characterData: true });
      new MutationObserver(sendTitle).observe(document.head || document.documentElement, { childList: true, subtree: true });
    })();`).catch((error) => log('Title observer injection failed:', id, error.message));
  });
  wc.loadURL(GAME_URL).catch((error) => {
    log('Game loadURL failed:', id, error.message);
    setStatus(id, { loading: false, state: 'error', error: error.message, title: 'Unable to open game' });
  });
  return view;
}

function activateAccount(id) {
  if (!findAccount(id) || !mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'Account not found' };
  if (accountViews[id] && (accountViews[id].webContents.isDestroyed() || accountViews[id].webContents.isCrashed() || accountStatus[id]?.state === 'crashed')) destroyGameView(id, 'renderer-restart');
  if (!accountViews[id]) accountViews[id] = createGameView(id);
  const view = accountViews[id];
  if (!attachView(view)) return { ok: false, error: 'Unable to attach account view' };
  activeAccountId = id;
  persistSettings({ lastActiveAccountId: id });
  setStatus(id, { lastActiveAt: Date.now() });
  applyZoom(view);
  scheduleLayout();
  applyPerformancePolicy();
  return { ok: true };
}

// ---------- IPC: launcher UI ----------
registerLauncherHandler('get-initial-state', () => ({
  appInfo: APP_INFO,
  settings,
  accounts,
  statusMap: { ...accountStatus },
  panelVisible: !!settings.hotkeyPanelVisible,
}));
registerLauncherHandler('open-external', (_event, value) => {
  const url = safeExternalUrl(value);
  if (!url) return { ok: false, error: 'Unsupported URL' };
  shell.openExternal(url).catch((error) => log('open-external failed:', error.message));
  return { ok: true };
});
registerLauncherHandler('save-settings', (_event, patch) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'Invalid settings' };
  const allowed = [
    'theme', 'sound', 'bannerDismissedVersion', 'hotkeyPanelVisible', 'startupBehavior',
    'performanceMode', 'compactMode', 'gameZoomFactor', 'autoUpdateEnabled',
  ];
  const sanitizedPatch = {};
  for (const key of allowed) if (Object.hasOwn(patch, key)) sanitizedPatch[key] = patch[key];
  const previousMode = settings.performanceMode;
  persistSettings(sanitizedPatch);
  if (previousMode !== settings.performanceMode) applyPerformancePolicy();
  if (attachedView) applyZoom(attachedView);
  return { ok: true, settings };
});
registerLauncherHandler('get-accounts', () => accounts);
registerLauncherHandler('add-account', (_event, name) => {
  const trimmed = String(name || '').trim().slice(0, 48);
  if (!trimmed) return { ok: false, error: 'Account name is required' };
  if (accounts.length >= 60) return { ok: false, error: 'Maximum of 60 accounts reached' };
  const id = `acc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const account = { id, name: trimmed };
  accounts.push(account);
  persistAccounts();
  buildMenu();
  return { ok: true, id, name: trimmed };
});
registerLauncherHandler('rename-account', (_event, id, name) => {
  const account = findAccount(id);
  const trimmed = String(name || '').trim().slice(0, 48);
  if (!account || !trimmed) return { ok: false, error: 'Invalid account or name' };
  account.name = trimmed;
  persistAccounts();
  buildMenu();
  return { ok: true };
});
registerLauncherHandler('reorder-accounts', (_event, ids) => {
  if (!Array.isArray(ids) || ids.length > 60) return { ok: false, error: 'Invalid ordering' };
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const ordered = [];
  for (const id of ids) if (byId.has(id)) { ordered.push(byId.get(id)); byId.delete(id); }
  ordered.push(...byId.values());
  accounts = ordered;
  persistAccounts();
  buildMenu();
  return { ok: true };
});
registerLauncherHandler('delete-account', async (_event, id) => {
  const account = findAccount(id);
  if (!account) return { ok: false, error: 'Account not found' };
  if (activeAccountId === id) { detachView(); activeAccountId = null; }
  destroyGameView(id, 'deleted');
  accounts = accounts.filter((item) => item.id !== id);
  delete accountStatus[id];
  persistAccounts();
  try { await session.fromPartition(`persist:krathorn-${id}`).clearStorageData(); } catch (error) { log('Session cleanup failed:', id, error.message); }
  try { await session.fromPartition(`persist:krathorn-${id}`).clearCache(); } catch (_) { /* ignore */ }
  notifyStatus();
  buildMenu();
  return { ok: true };
});
registerLauncherHandler('switch-account', (_event, id) => activateAccount(id));
registerLauncherHandler('reset-account', async (_event, id) => {
  if (!findAccount(id)) return { ok: false, error: 'Account not found' };
  destroyGameView(id, 'reset');
  const ses = session.fromPartition(`persist:krathorn-${id}`);
  await ses.clearStorageData();
  await ses.clearCache();
  if (id === activeAccountId) activateAccount(id);
  else setStatus(id, { state: 'idle', loading: false, unread: 0, error: null });
  return { ok: true };
});
registerLauncherHandler('reload-active', () => {
  if (activeAccountId && accountViews[activeAccountId] && !accountViews[activeAccountId].webContents.isDestroyed() && !accountViews[activeAccountId].webContents.isCrashed()) {
    accountViews[activeAccountId].webContents.reload();
  } else if (activeAccountId) {
    const id = activeAccountId;
    destroyGameView(id, 'reload-recovery');
    activateAccount(id);
  }
  return { ok: true };
});
registerLauncherHandler('set-top-offset', (_event, px) => {
  topOffset = Math.min(180, Math.max(0, Number.parseInt(px, 10) || 0));
  layoutActiveView();
  return { ok: true };
});
registerLauncherHandler('hide-view', () => { detachView(); return { ok: true }; });
registerLauncherHandler('show-view', () => {
  if (!activeAccountId) return { ok: false };
  const view = accountViews[activeAccountId];
  if (!view || view.webContents.isDestroyed()) return activateAccount(activeAccountId);
  return { ok: attachView(view) };
});
registerLauncherHandler('set-panel-visible', (_event, visible) => {
  persistSettings({ hotkeyPanelVisible: visible === true });
  scheduleLayout();
  return { ok: true };
});
registerLauncherHandler('get-performance-stats', async () => {
  const metrics = app.getAppMetrics();
  let workingSetKB = 0;
  for (const metric of metrics) workingSetKB += Number(metric.memory?.workingSetSize || 0);
  return {
    accountCount: accounts.length,
    loadedViews: Object.keys(accountViews).length,
    activeAccountId,
    processCount: metrics.length,
    memoryMB: Math.round(workingSetKB / 1024),
    mode: settings.performanceMode,
  };
});
registerLauncherHandler('check-for-updates', async () => {
  if (!updater) return { ok: false, error: 'Updater is unavailable in this build' };
  return updater.check(true);
});
registerLauncherHandler('download-update', async () => {
  if (!updater) return { ok: false, error: 'Updater is unavailable in this build' };
  return updater.download();
});
registerLauncherHandler('install-update', () => {
  if (!updater) return { ok: false, error: 'Updater is unavailable in this build' };
  return updater.install();
});

// Only registered game WebContents may report title changes, and the account ID is checked.
ipcMain.on('game-title', (event, payload) => {
  const expectedId = gameContentsToAccount.get(event.sender.id);
  if (!expectedId || !payload || payload.accountId !== expectedId) {
    log('Rejected game-title event from unregistered sender:', event.sender?.id);
    return;
  }
  const title = String(payload.title || '').slice(0, 512);
  const match = title.match(/\((\d{1,6})\)/);
  const unread = match ? Math.min(999999, Number.parseInt(match[1], 10) || 0) : 0;
  setStatus(expectedId, { title, unread });
});

// ---------- Lifecycle ----------
app.whenReady().then(() => {
  APP_INFO.version = app.getVersion();
  configureSessionPermissions(session.defaultSession);
  buildMenu();
  createSplash();
  createWindow();
  updater = initUpdater({
    getSettings: () => settings,
    send: (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater-status', payload);
    },
    log,
  });
  if (settings.autoUpdateEnabled) setTimeout(() => updater?.check(false), 12000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => log('whenReady failed:', error));

app.on('before-quit', () => {
  saveWindowState();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
