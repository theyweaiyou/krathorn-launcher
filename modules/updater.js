'use strict';

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

function initUpdater({ getSettings, send, log }) {
  let downloaded = false;
  let checking = false;
  const emit = (state, extra = {}) => send({ state, ...extra });

  if (!app.isPackaged || process.platform !== 'darwin') {
    log('Auto-updater disabled: updates require a packaged macOS build.');
    return {
      async check() {
        emit('unavailable', { message: 'Automatic updates are available in packaged, signed macOS builds.' });
        return { ok: false, error: 'Use a packaged macOS release to check for updates.' };
      },
      async download() { return { ok: false, error: 'Updater is unavailable in this build.' }; },
      install() { return { ok: false, error: 'Updater is unavailable in this build.' }; },
    };
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  // This release tracks stable GitHub Releases only. Beta/prerelease channels are not exposed.
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    checking = true;
    emit('checking');
  });
  autoUpdater.on('update-available', (info) => {
    checking = false;
    downloaded = false;
    emit('available', {
      version: info.version,
      releaseDate: info.releaseDate || null,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes.slice(0, 4000) : '',
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    checking = false;
    emit('not-available', { version: info.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    emit('downloading', {
      percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
      transferred: progress.transferred || 0,
      total: progress.total || 0,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    checking = false;
    downloaded = true;
    emit('downloaded', { version: info.version });
  });
  autoUpdater.on('error', (error) => {
    checking = false;
    log('Updater error:', error);
    emit('error', { message: String(error?.message || error || 'Update failed').slice(0, 500) });
  });

  return {
    async check(manual = false) {
      if (!getSettings().autoUpdateEnabled && !manual) return { ok: false, error: 'Automatic update checks are disabled.' };
      if (checking) return { ok: true, state: 'checking' };
      try {
        await autoUpdater.checkForUpdates();
        return { ok: true };
      } catch (error) {
        log('Update check failed:', error);
        emit('error', { message: String(error?.message || error).slice(0, 500) });
        return { ok: false, error: 'Update check failed.' };
      }
    },
    async download() {
      try {
        await autoUpdater.downloadUpdate();
        return { ok: true };
      } catch (error) {
        log('Update download failed:', error);
        emit('error', { message: String(error?.message || error).slice(0, 500) });
        return { ok: false, error: 'Update download failed.' };
      }
    },
    install() {
      if (!downloaded) return { ok: false, error: 'No downloaded update is ready to install.' };
      autoUpdater.quitAndInstall(true, true);
      return { ok: true };
    },
  };
}

module.exports = { initUpdater };
