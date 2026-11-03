const { contextBridge, ipcRenderer } = require('electron');

// The account id is passed by main.js via `additionalArguments: ['--account-id=...']`
// when the BrowserView is created. Each game view gets its own isolated bridge
// so notifications get attributed to the correct account.
const arg = process.argv.find((a) => a.startsWith('--account-id='));
const accountId = arg ? arg.split('=')[1] : null;

if (accountId) {
  contextBridge.exposeInMainWorld('__krathornBridge', {
    // Called by the injected notifier wrapper when the game fires window.Notification(...)
    // → forwards to main.js's 'game-notification' handler → native Electron Notification
    notify: (data) => {
      ipcRenderer.send('game-notification', {
        accountId,
        title: String((data && data.title) || ''),
        body: String((data && data.body) || ''),
      });
    },

    // Called by the injected title-watcher whenever document.title changes.
    // main.js parses a "(N)" prefix/suffix to derive the unread badge count.
    title: (t) => {
      ipcRenderer.send('game-title', {
        accountId,
        title: String(t || ''),
      });
    },
  });
}