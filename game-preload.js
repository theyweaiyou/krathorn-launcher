const { contextBridge, ipcRenderer } = require('electron');

const arg = process.argv.find((a) => a.startsWith('--account-id='));
const accountId = arg ? arg.split('=')[1] : null;

if (accountId) {
  contextBridge.exposeInMainWorld('__krathornBridge', {
    title: (t) => {
      ipcRenderer.send('game-title', {
        accountId,
        title: String(t || ''),
      });
    },
  });
}