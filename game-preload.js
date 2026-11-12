'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Each account view receives its own opaque account identifier at creation.
// The main process independently verifies the sender WebContents before use.
const arg = process.argv.find((value) => value.startsWith('--account-id='));
const accountId = arg ? arg.slice('--account-id='.length) : null;

if (accountId && /^acc-[a-z0-9-]{5,80}$/i.test(accountId)) {
  contextBridge.exposeInMainWorld('__krathornBridge', Object.freeze({
    title: (title) => ipcRenderer.send('game-title', {
      accountId,
      title: String(title || '').slice(0, 512),
    }),
  }));
}
