/* ============================================================
   Krathorn Launcher — Renderer
   ============================================================ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const accountsEl = $('#accounts');
const addBtn = $('#add-btn');
const emptyAddBtn = $('#empty-add-btn');
const reloadBtn = $('#reload-btn');
const settingsBtn = $('#settings-btn');

const banner = $('#banner');
const bannerVersion = $('#banner-version');
const bannerMessage = $('#banner-message');
const bannerClose = $('#banner-close');

const modal = $('#modal');
const modalTitle = $('#modal-title');
const modalInput = $('#modal-input');
const modalOk = $('#modal-ok');
const modalCancel = $('#modal-cancel');

const confirmModal = $('#confirm-modal');
const confirmTitle = $('#confirm-title');
const confirmMessage = $('#confirm-message');
const confirmOk = $('#confirm-ok');
const confirmCancel = $('#confirm-cancel');

const settingsModal = $('#settings-modal');
const settingsClose = $('#settings-close');
const settingSound = $('#setting-sound');
const settingNotifications = $('#setting-notifications');
const settingTheme = $('#setting-theme');

const toast = $('#toast');
const veil = $('#transition-veil');
const footerSite = $('#footer-site');

let accounts = [];
let statusMap = {};
let activeId = null;
let modalMode = null;
let modalTargetId = null;
let confirmResolve = null;
let settings = { sound: true, notifications: true, theme: 'midnight' };
let appInfo = { version: '1.0', author: 'theyweaiyou@gmail.com', banner: '' };
let isSwitching = false;
let newlyAddedId = null;
let dragSrcId = null;
let wasDragging = false;

/* ---------- Sound ---------- */
let audioCtx = null;
function playSound(kind = 'click') {
  if (!settings.sound) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(kind === 'success' ? 880 : kind === 'error' ? 220 : 620, now);
    if (kind === 'success') osc.frequency.exponentialRampToValueAtTime(1200, now + 0.06);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } catch (_) { /* ignore */ }
}

/* ---------- Overlay counter ---------- */
let overlayCount = 0;
async function pushOverlay() {
  overlayCount++;
  if (overlayCount === 1) await window.launcherAPI.hideView();
}
async function popOverlay() {
  overlayCount = Math.max(0, overlayCount - 1);
  if (overlayCount === 0) await window.launcherAPI.showView();
}
function schedulePopOverlay() { setTimeout(() => popOverlay(), 0); }

/* ---------- Toast ---------- */
let toastTimer = null;
function showToast(msg, type = 'info') {
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.className = 'toast'), 2400);
}

/* ---------- Confirm ---------- */
async function showConfirm(title, message) {
  await pushOverlay();
  return new Promise((resolve) => {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmModal.classList.remove('hidden');
    confirmResolve = resolve;
  });
}
function resolveConfirm(value) {
  confirmModal.classList.add('hidden');
  if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(value); }
  schedulePopOverlay();
}
confirmOk.addEventListener('click', () => resolveConfirm(true));
confirmCancel.addEventListener('click', () => resolveConfirm(false));

/* ---------- Banner ---------- */
// Render banner text safely, turning any https?:// URLs into clickable links
// that open in the system browser. Plain text is inserted as text nodes so
// nothing is ever interpreted as HTML.
function renderBannerMessage(text) {
  bannerMessage.textContent = '';
  const source = String(text || '');
  // Split keeping the URL as its own token
  const parts = source.split(/(https?:\/\/[^\s]+)/g);
  for (const part of parts) {
    if (!part) continue;
    if (/^https?:\/\//.test(part)) {
      const a = document.createElement('a');
      a.className = 'banner-link';
      a.href = '#';
      a.textContent = part;
      a.title = part;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.launcherAPI.openExternal(part);
      });
      bannerMessage.appendChild(a);
    } else {
      bannerMessage.appendChild(document.createTextNode(part));
    }
  }
}

async function updateTopOffset() {
  // Read the real rendered height so a 1- or 2-line banner both work
  const h = banner.classList.contains('hidden') ? 0 : banner.offsetHeight + 8;
  document.documentElement.style.setProperty('--top-offset', `calc(var(--topbar-h) + ${h}px)`);
  await window.launcherAPI.setTopOffset(h);
}

async function setupBanner() {
  bannerVersion.textContent = 'v' + appInfo.version;
  renderBannerMessage(appInfo.banner || '');
  if (settings.bannerDismissedVersion === appInfo.version) {
    banner.classList.add('hidden');
  } else {
    banner.classList.remove('hidden');
  }
  await updateTopOffset();
}

bannerClose.addEventListener('click', async () => {
  playSound('click');
  banner.classList.add('hidden');
  await updateTopOffset();
  await window.launcherAPI.saveSettings({ bannerDismissedVersion: appInfo.version });
  settings.bannerDismissedVersion = appInfo.version;
});

/* ---------- Settings application ---------- */
function applySettings(s) {
  settings = { ...settings, ...s };
  if (settings.theme !== 'light') settings.theme = 'midnight';
  document.documentElement.dataset.theme = settings.theme;
  settingSound.checked = !!settings.sound;
  settingNotifications.checked = !!settings.notifications;
  settingTheme.value = settings.theme;
}

/* ---------- Accounts ---------- */
function renderAccounts() {
  accountsEl.innerHTML = '';

  if (accounts.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'accounts-empty';
    empty.textContent = 'No accounts yet — click + to add';
    accountsEl.appendChild(empty);
    return;
  }

  for (const acct of accounts) {
    const st = statusMap[acct.id] || {};
    const chip = document.createElement('div');
    chip.className = 'account-chip' + (acct.id === activeId ? ' active' : '');
    chip.dataset.id = acct.id;
    chip.title = acct.name;
    chip.draggable = true;
    chip.style.webkitAppRegion = 'no-drag';

    if (newlyAddedId === acct.id) {
      chip.classList.add('entering');
      setTimeout(() => chip.classList.remove('entering'), 320);
    }

    const dot = document.createElement('span');
    dot.className = 'dot' + (st.loading ? ' loading' : '');

    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = acct.name;

    chip.append(dot, label);

    if (st.unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = st.unread > 99 ? '99+' : String(st.unread);
      chip.appendChild(badge);
    }

    const menuBtn = document.createElement('button');
    menuBtn.className = 'menu-btn';
    menuBtn.type = 'button';
    menuBtn.textContent = '⋯';
    menuBtn.title = 'Options';
    menuBtn.style.webkitAppRegion = 'no-drag';
    menuBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      playSound('click');
      showAccountMenu(acct, e.currentTarget.getBoundingClientRect());
    });
    chip.appendChild(menuBtn);

    chip.addEventListener('dragstart', (e) => {
      dragSrcId = acct.id;
      wasDragging = true;
      chip.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', acct.id); } catch (_) {}
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('dragging');
      setTimeout(() => { wasDragging = false; }, 50);
      $$('.account-chip.drop-target').forEach((c) => c.classList.remove('drop-target'));
    });
    chip.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (acct.id !== dragSrcId) chip.classList.add('drop-target');
    });
    chip.addEventListener('dragleave', () => chip.classList.remove('drop-target'));
    chip.addEventListener('drop', async (e) => {
      e.preventDefault();
      chip.classList.remove('drop-target');
      if (!dragSrcId || dragSrcId === acct.id) return;
      const fromIdx = accounts.findIndex((a) => a.id === dragSrcId);
      const toIdx = accounts.findIndex((a) => a.id === acct.id);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = accounts.splice(fromIdx, 1);
      accounts.splice(toIdx, 0, moved);
      renderAccounts();
      await window.launcherAPI.reorderAccounts(accounts.map((a) => a.id));
      playSound('click');
    });

    chip.addEventListener('click', () => {
      if (wasDragging) return;
      playSound('click');
      selectAccount(acct.id);
    });

    accountsEl.appendChild(chip);
  }
}

async function selectAccount(id) {
  if (isSwitching || id === activeId) return;
  const isFirst = !activeId;

  isSwitching = true;
  try {
    if (!isFirst) {
      await window.launcherAPI.hideView();
      veil.classList.add('show');
      await new Promise((r) => setTimeout(r, 150));
    }

    activeId = id;
    document.body.classList.add('has-view');
    renderAccounts();

    if (!isFirst) {
      await window.launcherAPI.switchAccount(id, { prepareOnly: true });
      await new Promise((r) => setTimeout(r, 120));
    }

    await window.launcherAPI.switchAccount(id);

    if (!isFirst) {
      await new Promise((r) => setTimeout(r, 100));
      veil.classList.remove('show');
    }
  } finally {
    isSwitching = false;
  }
}

/* ---------- Account mini-menu ---------- */
async function showAccountMenu(acct, rect) {
  await pushOverlay();
  $$('.mini-menu').forEach((m) => m.remove());

  const menu = document.createElement('div');
  menu.className = 'mini-menu';
  menu.style.position = 'fixed';
  const MENU_W = 200;
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_W - 8)) + 'px';
  menu.style.top = rect.bottom + 6 + 'px';

  const items = [
    { label: 'Rename', action: () => openRename(acct) },
    { label: 'Reset data (logout)', action: () => resetAccount(acct) },
    { label: 'Delete account', action: () => deleteAccount(acct), danger: true },
  ];

  let closed = false;
  const closeMenu = (chained) => {
    if (closed) return;
    closed = true;
    menu.remove();
    document.removeEventListener('mousedown', outsideClick, true);
    if (chained) schedulePopOverlay();
    else popOverlay();
  };
  const outsideClick = (ev) => { if (!menu.contains(ev.target)) closeMenu(false); };

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'mini-menu-item' + (item.danger ? ' danger' : '');
    row.textContent = item.label;
    row.style.webkitAppRegion = 'no-drag';
    row.addEventListener('mousedown', (e) => e.stopPropagation());
    row.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeMenu(true);
      await item.action();
    });
    menu.appendChild(row);
  }

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('mousedown', outsideClick, true), 0);
}

/* ---------- Add / Rename ---------- */
async function openAdd() {
  if (!modal.classList.contains('hidden')) return;
  playSound('click');
  modalMode = 'add';
  modalTargetId = null;
  modalTitle.textContent = 'Add';
  modalInput.value = '';
  await pushOverlay();
  modal.classList.remove('hidden');
  setTimeout(() => modalInput.focus(), 50);
}

async function openRename(acct) {
  if (!modal.classList.contains('hidden')) return;
  modalMode = 'rename';
  modalTargetId = acct.id;
  modalTitle.textContent = 'Rename Account';
  modalInput.value = acct.name;
  await pushOverlay();
  modal.classList.remove('hidden');
  setTimeout(() => { modalInput.focus(); modalInput.select(); }, 50);
}

modalCancel.addEventListener('click', () => {
  playSound('click');
  modal.classList.add('hidden');
  popOverlay();
});

modalOk.addEventListener('click', async () => {
  const value = modalInput.value.trim();
  if (!value) return;

  if (modalMode === 'add') {
    const res = await window.launcherAPI.addAccount(value);
    if (res.ok) {
      newlyAddedId = res.id;
      accounts = await window.launcherAPI.getAccounts();
      renderAccounts();
      modal.classList.add('hidden');
      await popOverlay();
      await selectAccount(res.id);
      playSound('success');
      showToast(`Added "${res.name}"`, 'success');
      setTimeout(() => { newlyAddedId = null; }, 400);
    } else {
      playSound('error');
      showToast(res.error || 'Failed to add', 'error');
    }
  } else if (modalMode === 'rename') {
    await window.launcherAPI.renameAccount(modalTargetId, value);
    accounts = await window.launcherAPI.getAccounts();
    renderAccounts();
    modal.classList.add('hidden');
    popOverlay();
    playSound('success');
    showToast('Renamed', 'success');
  }
});

modalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') modalOk.click();
  if (e.key === 'Escape') modalCancel.click();
});

/* ---------- Reset / Delete ---------- */
async function resetAccount(acct) {
  const ok = await showConfirm('Reset data', `Reset data for "${acct.name}"? You will be logged out.`);
  if (!ok) { playSound('click'); return; }
  await window.launcherAPI.resetAccount(acct.id);
  playSound('success');
  showToast(`Reset "${acct.name}"`, 'success');
}

async function deleteAccount(acct) {
  const ok = await showConfirm('Delete account', `Delete "${acct.name}"? This permanently removes its login data.`);
  if (!ok) { playSound('click'); return; }

  const chip = accountsEl.querySelector(`[data-id="${acct.id}"]`);
  if (chip) {
    chip.classList.add('removing');
    await new Promise((r) => setTimeout(r, 220));
  }

  await window.launcherAPI.deleteAccount(acct.id);
  if (activeId === acct.id) {
    activeId = null;
    document.body.classList.remove('has-view');
  }
  accounts = await window.launcherAPI.getAccounts();
  renderAccounts();
  playSound('success');
  showToast(`Deleted "${acct.name}"`, 'success');
}

/* ---------- Settings ---------- */
settingsBtn.addEventListener('click', async () => {
  playSound('click');
  await pushOverlay();
  settingsModal.classList.remove('hidden');
});

settingsClose.addEventListener('click', async () => {
  playSound('click');
  const patch = {
    sound: settingSound.checked,
    notifications: settingNotifications.checked,
    theme: settingTheme.value === 'light' ? 'light' : 'midnight',
  };
  await window.launcherAPI.saveSettings(patch);
  applySettings(patch);
  settingsModal.classList.add('hidden');
  popOverlay();
});

/* ---------- Footer / buttons ---------- */
// Open the Krathorn site in the user's default browser.
// preventDefault stops the launcher window from navigating away from itself,
// and the null guard keeps the renderer alive even if the footer link is
// ever removed from the markup.
if (footerSite) {
  footerSite.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.launcherAPI.openExternal('https://krathorn.com/');
  });
}

addBtn.addEventListener('click', openAdd);
emptyAddBtn.addEventListener('click', openAdd);
reloadBtn.addEventListener('click', () => { playSound('click'); window.launcherAPI.reloadActive(); });

/* ---------- Keyboard ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!modal.classList.contains('hidden')) { modal.classList.add('hidden'); popOverlay(); }
  if (!settingsModal.classList.contains('hidden')) { settingsModal.classList.add('hidden'); popOverlay(); }
  if (!confirmModal.classList.contains('hidden')) resolveConfirm(false);
});

/* ---------- Status ---------- */
window.launcherAPI.onStatusUpdate((s) => { statusMap = s || {}; renderAccounts(); });
window.launcherAPI.onRequestSwitch((id) => { if (id && id !== activeId) selectAccount(id); });
window.launcherAPI.onRequestAddAccount(openAdd);

/* ---------- Boot ---------- */
(async () => {
  try {
    const state = await window.launcherAPI.getInitialState();
    appInfo = state.appInfo;
    settings = state.settings;
    accounts = state.accounts || [];
    statusMap = state.statusMap || {};
    applySettings(settings);

    // AWAIT — banner must finish sizing topOffset BEFORE any view attaches
    await setupBanner();

    renderAccounts();

    if (accounts.length > 0) {
      await selectAccount(accounts[0].id);
    }

    window.addEventListener('resize', () => $$('.mini-menu').forEach((m) => m.remove()));
  } catch (err) {
    console.error('[boot]', err);
    document.body.innerHTML = `<pre style="color:#f88;padding:20px;font-family:monospace">Boot error: ${err.message}\n${err.stack || ''}</pre>`;
  }
})();