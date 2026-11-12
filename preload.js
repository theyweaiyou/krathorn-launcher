const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('launcherAPI', {
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  checkUpdate: () => ipcRenderer.invoke('check-update'),

  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  addAccount: (name, proxy, keepActive) => ipcRenderer.invoke('add-account', name, proxy, keepActive),
  updateAccount: (id, patch) => ipcRenderer.invoke('update-account', id, patch),
  renameAccount: (id, name) => ipcRenderer.invoke('rename-account', id, name),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),
  reorderAccounts: (ids) => ipcRenderer.invoke('reorder-accounts', ids),

  switchAccount: (id, opts) => ipcRenderer.invoke('switch-account', id, opts),
  resetAccount: (id) => ipcRenderer.invoke('reset-account', id),
  reloadActive: () => ipcRenderer.invoke('reload-active'),
  reloadAll: () => ipcRenderer.invoke('reload-all'),
  muteAll: (muted) => ipcRenderer.invoke('mute-all', muted),
  setAccountMuted: (id, muted) => ipcRenderer.invoke('set-account-muted', id, muted),
  setAccountZoom: (id, zoom) => ipcRenderer.invoke('set-account-zoom', id, zoom),
  detachAccount: (id) => ipcRenderer.invoke('detach-account', id),
  setTopOffset: (px) => ipcRenderer.invoke('set-top-offset', px),

  getStatus: () => ipcRenderer.invoke('get-status'),
  onStatusUpdate: (cb) => subscribe('status-update', cb),
  onRequestSwitch: (cb) => subscribe('request-switch', cb),
  onRequestAddAccount: (cb) => subscribe('request-add-account', cb),
  onRequestTogglePanel: (cb) => subscribe('request-toggle-panel', cb),
  onUpdateAvailable: (cb) => subscribe('update-available', cb),
  onMuteAllChanged: (cb) => subscribe('mute-all-changed', cb),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  hideView: () => ipcRenderer.invoke('hide-view'),
  showView: () => ipcRenderer.invoke('show-view'),
  setPanelVisible: (v) => ipcRenderer.invoke('set-panel-visible', v),
});