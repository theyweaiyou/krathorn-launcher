const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherAPI', {
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  addAccount: (name) => ipcRenderer.invoke('add-account', name),
  renameAccount: (id, name) => ipcRenderer.invoke('rename-account', id, name),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),
  reorderAccounts: (ids) => ipcRenderer.invoke('reorder-accounts', ids),

  switchAccount: (id, opts) => ipcRenderer.invoke('switch-account', id, opts),
  resetAccount: (id) => ipcRenderer.invoke('reset-account', id),
  reloadActive: () => ipcRenderer.invoke('reload-active'),
  setTopOffset: (px) => ipcRenderer.invoke('set-top-offset', px),

  getStatus: () => ipcRenderer.invoke('get-status'),
  onStatusUpdate: (cb) => {
    const l = (_e, s) => cb(s);
    ipcRenderer.on('status-update', l);
    return () => ipcRenderer.removeListener('status-update', l);
  },
  onRequestSwitch: (cb) => {
    const l = (_e, id) => cb(id);
    ipcRenderer.on('request-switch', l);
    return () => ipcRenderer.removeListener('request-switch', l);
  },
  onRequestAddAccount: (cb) => {
    const l = () => cb();
    ipcRenderer.on('request-add-account', l);
    return () => ipcRenderer.removeListener('request-add-account', l);
  },

  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  hideView: () => ipcRenderer.invoke('hide-view'),
  showView: () => ipcRenderer.invoke('show-view'),

  setPanelVisible: (v) => ipcRenderer.invoke('set-panel-visible', v),
});