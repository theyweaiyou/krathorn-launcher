'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('launcherAPI', Object.freeze({
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  addAccount: (name) => ipcRenderer.invoke('add-account', name),
  renameAccount: (id, name) => ipcRenderer.invoke('rename-account', id, name),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),
  reorderAccounts: (ids) => ipcRenderer.invoke('reorder-accounts', ids),
  switchAccount: (id) => ipcRenderer.invoke('switch-account', id),
  resetAccount: (id) => ipcRenderer.invoke('reset-account', id),
  reloadActive: () => ipcRenderer.invoke('reload-active'),
  setTopOffset: (px) => ipcRenderer.invoke('set-top-offset', px),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  hideView: () => ipcRenderer.invoke('hide-view'),
  showView: () => ipcRenderer.invoke('show-view'),
  setPanelVisible: (visible) => ipcRenderer.invoke('set-panel-visible', visible),
  getPerformanceStats: () => ipcRenderer.invoke('get-performance-stats'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onStatusUpdate: (callback) => subscribe('status-update', callback),
  onUpdaterStatus: (callback) => subscribe('updater-status', callback),
  onRequestSwitch: (callback) => subscribe('request-switch', callback),
  onRequestAddAccount: (callback) => subscribe('request-add-account', callback),
}));
