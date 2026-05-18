/**
 * ============================================================
 * Kiyo Browser — main.js  (Final Integration Pass)
 * ============================================================
 * Features integrated in this file:
 *
 *  • Core browser shell: multi-window, WebContentsView tabs,
 *    session persistence, lazy-tab loading.
 *
 *  • Tab Groups (IPC: show-tab-menu → tab-menu-action)
 *    Groups are serialised into the session JSON alongside tabs.
 *
 *  • Tab Sleeping (IPC: sleep-tab-now, wake-tab, sleep-all-tabs,
 *    get-sleep-stats). Configurable via tabSleepEnabled /
 *    tabSleepDelay settings.  Sleeping removes the WebContentsView
 *    from memory; waking recreates it.
 *
 *  • Ad-blocker & Privacy Shield (lib/adblock, lib/privacy).
 *    Controlled via adblockEnabled / blockHyperlinkAuditing /
 *    strictHttps settings.  IPC: get-adblock-stats,
 *    toggle-adblock, reset-adblock-stats.
 *
 *  • Reader Mode (lib/readability).  IPC: extract-article,
 *    check-reader-mode.  Shortcut: Ctrl+Shift+R → toggle-reader.
 *
 *  • Encrypted Password Manager (lib/passwords).  IPC: pw-is-setup,
 *    pw-is-unlocked, pw-setup, pw-unlock, pw-lock, pw-save, pw-get,
 *    pw-get-all, pw-delete, pw-search, pw-captured, pw-save-pending,
 *    pw-discard-pending.  Auto-fill injected on did-finish-load.
 *
 *  • Keyboard shortcuts handled via before-input-event interception
 *    (no globalShortcut to avoid conflicts with other apps):
 *      Ctrl+T  → new-tab
 *      Ctrl+W  → close-tab
 *      Ctrl+L  → focus-url
 *      Ctrl+R  → reload  (Ctrl+Shift+R → toggle-reader)
 *      Ctrl+F  → open-find
 *      Ctrl+=  → zoom-in   Ctrl+-  → zoom-out  Ctrl+0 → zoom-reset
 *      Ctrl+Shift+K → tab-search
 *      Ctrl+Shift+P → open-passwords
 *      Ctrl+Shift+N → open-private-window
 *
 *  • IPC handlers verified deduplicated (no duplicate ipcMain.handle
 *    registrations).  remove-history-entry handler added (was exposed
 *    in preload but missing in main).
 *
 *  • PAGE object contains: home, settings, downloads, bookmarks,
 *    history, note, error, welcome, reader, passwords.
 *
 *  • SETTINGS_DEFAULTS & SETTING_SCHEMA include: theme, blurIntensity,
 *    tabStyle, searchEngine, adblockEnabled, blockHyperlinkAuditing,
 *    strictHttps, tabSleepEnabled, tabSleepDelay, geometry.
 * ============================================================
 */
const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── Modules ──────────────────────────────────────────────────────────────────
const { PrivateSessionManager } = require('./lib/session');
const { setupPrivacyShield, bindCosmeticFilters } = require('./lib/privacy');
const { readJSON, writeJSON } = require('./lib/utils');
const adblock = require('./adblock');
const { extractArticle, isArticlePage } = require('./readability');
const PasswordManager = require('./passwords');

// ─── App config ───────────────────────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
const pwManager = new PasswordManager(USER_DATA);
const SETTINGS_PATH = path.join(USER_DATA, 'kiyo-settings.json');
const BOOKMARKS_PATH = path.join(USER_DATA, 'kiyo-bookmarks.json');
const HISTORY_PATH = path.join(USER_DATA, 'kiyo-history.json');
const SESSION_PATH = path.join(USER_DATA, 'kiyo-session.json');
const QUICKLINKS_PATH = path.join(USER_DATA, 'kiyo-quicklinks.json');

const MAX_TABS = 20;
const MAX_BOOKMARKS = 500;
const MAX_HISTORY_ENTRIES = 1000;
const MAX_DOWNLOADS_HISTORY = 50;

const { randomUUID } = require('crypto');
function newTabId() { return randomUUID(); }

// ─── Internal page URLs ───────────────────────────────────────────────────────
const PAGE = {
  home: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'newtab', 'newtab.html'),
  settings: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'settings', 'settings.html'),
  downloads: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'downloads', 'downloads.html'),
  bookmarks: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'bookmarks', 'bookmarks.html'),
  history: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'history', 'history.html'),
  note: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'note', 'note.html'),
  error: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'error', 'error.html'),
  welcome: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'welcome', 'welcome.html'),
  reader: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'reader', 'reader.html'),
  passwords: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'passwords', 'passwords.html'),
};

function normaliseFileUrl(u) {
  try {
    if (u.startsWith('file://')) return path.normalize(decodeURIComponent(u.slice(7)));
  } catch (e) { }
  return u;
}

// ─── Global State ─────────────────────────────────────────────────────────────
const windows = new Map(); // win.webContents.id -> winState
const viewToWindow = new Map(); // view.webContents.id -> winState
const downloads = [];
const pendingCredentials = new Map(); // wc.id -> { domain, username, password }

const tabSleepTimers = new Map(); // tabId → setTimeout handle
const sleepedTabs = new Map();    // tabId → { url, title, favicon } (sleeping tabs have no view)
const TAB_SLEEP_DELAY = 30 * 60 * 1000; // 30 minutes default, configurable

const SETTINGS_DEFAULTS = {
  theme: 'default',
  blurIntensity: 25,
  tabStyle: 'squircle',
  searchEngine: 'google',
  geometry: { sidebarWidth: 72, headerHeight: 60 },
  tabSleepEnabled: true,
  tabSleepDelay: 30,
  adblockEnabled: true,
  blockHyperlinkAuditing: true,
  strictHttps: false,
};

const SETTING_SCHEMA = {
  theme: v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v),
  blurIntensity: v => typeof v === 'number' && v >= 0 && v <= 60,
  tabStyle: v => ['squircle', 'square', 'circle'].includes(v),
  searchEngine: v => ['google', 'bing', 'duckduckgo'].includes(v),
  geometry: v => v && typeof v.sidebarWidth === 'number' && typeof v.headerHeight === 'number',
  tabSleepEnabled: v => typeof v === 'boolean',
  tabSleepDelay: v => typeof v === 'number' && v >= 1 && v <= 120,
  adblockEnabled: v => typeof v === 'boolean',
  blockHyperlinkAuditing: v => typeof v === 'boolean',
  strictHttps: v => typeof v === 'boolean',
};

let settings = { ...SETTINGS_DEFAULTS };
let bookmarks = [];
let history = [];
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const saveSettings = debounce(() => writeJSON(SETTINGS_PATH, settings), 500);
const saveBookmarks = debounce(() => writeJSON(BOOKMARKS_PATH, bookmarks), 500);
const saveHistory = debounce(() => writeJSON(HISTORY_PATH, history), 500);

function loadSettings() {
  const raw = readJSON(SETTINGS_PATH, {});
  for (const [key, validate] of Object.entries(SETTING_SCHEMA)) {
    if (key in raw && validate(raw[key])) settings[key] = raw[key];
  }
}
function loadBookmarks() { bookmarks = readJSON(BOOKMARKS_PATH, []); }
function loadHistory() { history = readJSON(HISTORY_PATH, []); }

// ─── URL resolution + security ────────────────────────────────────────────────
function resolveUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const t = raw.trim();

  let alias = t.startsWith('kiyo://') ? t.replace('kiyo://', '') : t;
  alias = alias.replace(/\/$/, '');
  if (PAGE[alias]) return PAGE[alias]();

  if (/^(javascript|data|vbscript|blob):/i.test(t)) return null;

  if (/^file:\/\//i.test(t)) {
    const allowed = Object.values(PAGE).map(fn => normaliseFileUrl(fn()));
    return allowed.includes(normaliseFileUrl(t)) ? t : null;
  }

  if (/^https?:\/\//i.test(t)) {
    if (settings.strictHttps && t.toLowerCase().startsWith('http://')) {
      return 'https://' + t.slice(7);
    }
    return t;
  }

  if (!t.includes(' ') && /\./.test(t)) return 'https://' + t;

  const q = encodeURIComponent(t);
  const engines = {
    bing: `https://www.bing.com/search?q=${q}`,
    duckduckgo: `https://duckduckgo.com/?q=${q}`,
    google: `https://www.google.com/search?q=${q}`,
  };
  return engines[settings.searchEngine] || engines.google;
}

function getUIUrl(url) {
  if (!url) return '';
  const norm = normaliseFileUrl(url);
  for (const [alias, fn] of Object.entries(PAGE)) {
    if (norm === normaliseFileUrl(fn())) return `kiyo://${alias}`;
  }
  return url;
}

// ─── History helpers ──────────────────────────────────────────────────────────
function pushHistory(url, title, isPrivate) {
  if (isPrivate) return; 
  const uiUrl = getUIUrl(url);
  if (!uiUrl || uiUrl.startsWith('kiyo://') || url.startsWith('file://')) return;
  const entry = { url, title: title || url, visitedAt: Date.now() };
  history.unshift(entry);
  if (history.length > MAX_HISTORY_ENTRIES) history.splice(MAX_HISTORY_ENTRIES);
  saveHistory();
  broadcast('history-updated');
}

// ─── Window creation ──────────────────────────────────────────────────────────
function createWindow(isPrivate = false, restoredSession = null) {
  if (isPrivate) PrivateSessionManager.increment();

  const win = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 800, minHeight: 500,
    backgroundColor: '#0a0b10',
    title: isPrivate ? 'Kiyo Browser — Private' : 'Kiyo Browser',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      partition: isPrivate ? PrivateSessionManager.getPartitionId() : undefined,
    },
  });

  // Apply Ad Blocker to this window's session
  setupPrivacyShield(win.webContents.session);
  setupAdblock(win.webContents.session);
  bindCosmeticFilters(win.webContents);

  // Ensure spellchecker is enabled for the session (especially for private partitions)
  win.webContents.session.setSpellCheckerEnabled(true);
  win.webContents.session.setSpellCheckerLanguages(['en-US']);

  const winState = {
    window: win,
    views: new Map(),
    activeViewId: null,
    isPrivate,
    partitionId: isPrivate ? PrivateSessionManager.getPartitionId() : undefined
  };
  windows.set(win.webContents.id, winState);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'ui', 'index.html'));
  let _resizeTimer = null;
  win.on('resize', () => {
    if (_resizeTimer) clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => updateActiveViewBounds(winState), 16);
  });

  // ── CSP ─────────────────────────────────────────────────────────────────────
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('file://')) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' file:; " +
            "script-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com data:; " +
            "img-src * data: blob:; " +
            "connect-src 'self' https: wss:;",
          ],
        },
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  // ── Permissions ───────────────────────────────────────────────────────────────
  const ALLOWED_PERMISSIONS = new Set([
    'media', 'geolocation', 'notifications', 'fullscreen',
    'pointerLock', 'openExternal', 'clipboard-read', 'clipboard-sanitized-write',
    'idle-detection', 'payment', 'midi',
  ]);
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    return ALLOWED_PERMISSIONS.has(permission);
  });

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  win.on('close', () => {
    if (isPrivate) PrivateSessionManager.decrement();
    if (!isPrivate) {
      const sessionTabs = [];
      for (const [tabId, view] of winState.views) {
        try {
          if (!view.webContents.isDestroyed()) {
            sessionTabs.push({ id: tabId, url: view.webContents.getURL() || 'home' });
          }
        } catch { }
      }
      if (sessionTabs.length > 0) {
        writeJSON(SESSION_PATH, { tabs: sessionTabs, activeTabId: winState.activeViewId });
      }
    }
    
    // Explicitly destroy views
    for (const view of winState.views.values()) {
      viewToWindow.delete(view.webContents.id);
      view.webContents.destroy();
    }
    windows.delete(win.webContents.id);
  });

  // ── Download tracking ────────────────────────────────────────────────────────
  win.webContents.session.on('will-download', (_, item) => {
    if (isPrivate) return; 
    const name = item.getFilename();
    if (downloads.length >= MAX_DOWNLOADS_HISTORY) downloads.splice(0, 1);
    const obj = { name, progress: 0, state: 'progressing', startedAt: Date.now() };
    downloads.push(obj);
    broadcast('downloads-updated', downloads);

    item.on('updated', (_, state) => {
      if (state === 'progressing') {
        const total = item.getTotalBytes();
        const prog = total > 0 ? item.getReceivedBytes() / total : 0;
        obj.progress = prog;
        win.webContents.send('download-progress', name, prog);
      }
    });
    item.once('done', (_, state) => {
      obj.state = state;
      obj.progress = 1;
      broadcast('downloads-updated', downloads);
      win.webContents.send('download-completed', name, state);
    });
  });

  return win;
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('renderer-ready', (event) => {
  const winState = getWinState(event.sender);
  if (!winState) return null;

  let sessionData = null;
  if (!winState.isPrivate) {
    sessionData = readJSON(SESSION_PATH, null);
  }

  return {
    settings,
    maxTabs: MAX_TABS,
    session: sessionData,
    isPrivate: winState.isPrivate,
    firstRun: !fs.existsSync(path.join(USER_DATA, 'kiyo-onboarded.json'))
  };
});

ipcMain.handle('get-settings', () => settings);

ipcMain.handle('get-adblock-stats', () => adblock.getStats());
ipcMain.on('toggle-adblock', (_, enabled) => {
  settings.adblockEnabled = enabled;
  saveSettings();
});
ipcMain.on('reset-adblock-stats', () => adblock.resetStats());

ipcMain.handle('get-browser-stats', () => {
  let totalTabs = 0;
  for (const winState of windows.values()) {
    totalTabs += winState.views.size;
  }
  return {
    tabs: totalTabs,
    bookmarks: bookmarks.length,
    history: history.length
  };
});

ipcMain.on('finish-onboarding', () => {
  writeJSON(path.join(USER_DATA, 'kiyo-onboarded.json'), { onboarded: true, date: Date.now() });
});

ipcMain.on('update-setting', async (event, key, value) => {
  if (!SETTING_SCHEMA[key] || !SETTING_SCHEMA[key](value)) return;

  if (key === 'theme' && value !== 'default') {
    const themesPath = path.join(__dirname, '..', 'renderer', 'themes');
    const themeFiles = fs.readdirSync(themesPath)
      .filter(f => f.endsWith('.css'))
      .map(f => f.replace('.css', ''));
    
    // Also check subdirectories for themes (as mentioned in tasks.md)
    const subDirs = fs.readdirSync(themesPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    
    if (!themeFiles.includes(value) && !subDirs.includes(value)) return;
  }

  settings[key] = value;
  saveSettings();
  broadcast('theme-updated', settings);
});

ipcMain.on('update-geometry', (event, geometry) => {
  const winState = getWinState(event.sender);
  if (winState && SETTING_SCHEMA.geometry(geometry)) {
    settings.geometry = geometry;
    saveSettings();
    updateActiveViewBounds(winState);
  }
});

ipcMain.handle('get-downloads', () => downloads);
ipcMain.on('clear-downloads', () => {
  downloads.splice(0);
  broadcast('downloads-cleared');
});

ipcMain.handle('get-sleep-stats', () => {
  let activeCount = 0;
  for (const winState of windows.values()) {
    activeCount += winState.views.size;
  }
  return { sleeping: sleepedTabs.size, active: activeCount };
});

ipcMain.on('wake-tab', (event, id) => {
  const winState = getWinState(event.sender);
  if (winState) wakeTab(winState, id);
});

ipcMain.on('sleep-tab-now', (event, id) => {
  const winState = getWinState(event.sender);
  if (winState) sleepTab(winState, id);
});

ipcMain.on('sleep-all-tabs', (event) => {
  const winState = getWinState(event.sender);
  if (!winState) return;
  for (const id of winState.views.keys()) {
    if (id !== winState.activeViewId) sleepTab(winState, id);
  }
});

ipcMain.handle('get-bookmarks', () => bookmarks);
ipcMain.on('add-bookmark', (_, bookmark) => {
  if (!bookmark || typeof bookmark.url !== 'string') return;
  if (bookmarks.some(b => b.url === bookmark.url)) return;
  if (bookmarks.length >= MAX_BOOKMARKS) bookmarks.pop();
  bookmarks.unshift({ url: bookmark.url, title: bookmark.title || bookmark.url, addedAt: Date.now() });
  saveBookmarks();
  broadcast('bookmarks-updated', bookmarks);
});
ipcMain.on('remove-bookmark', (_, url) => {
  const before = bookmarks.length;
  bookmarks = bookmarks.filter(b => b.url !== url);
  if (bookmarks.length !== before) {
    saveBookmarks();
    broadcast('bookmarks-updated', bookmarks);
  }
});
ipcMain.handle('is-bookmarked', (_, url) => bookmarks.some(b => b.url === url));

ipcMain.handle('get-history', () => history);
ipcMain.on('clear-history', () => {
  history = [];
  saveHistory();
  broadcast('history-updated');
});
ipcMain.on('remove-history-entry', (_, url) => {
  const before = history.length;
  history = history.filter(h => h.url !== url);
  if (history.length !== before) {
    saveHistory();
    broadcast('history-updated');
  }
});

ipcMain.handle('get-available-themes', () => {
  const themesPath = path.join(__dirname, '..', 'renderer', 'themes');
  if (!fs.existsSync(themesPath)) return [];
  const results = [];
  for (const entry of fs.readdirSync(themesPath, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.css')) {
      const name = entry.name.replace('.css', '');
      results.push({ id: name, name: name.charAt(0).toUpperCase() + name.slice(1) });
    }
  }
  return results;
});

ipcMain.handle('get-quick-links', () => readJSON(QUICKLINKS_PATH, null));
ipcMain.on('save-quick-links', (_, links) => writeJSON(QUICKLINKS_PATH, links));

ipcMain.on('create-tab', (event, id, url, lazy = false) => {
  const winState = getWinState(event.sender);
  if (!winState) return;
  if (winState.views.size >= MAX_TABS) {
    winState.window.webContents.send('tab-limit-reached');
    return;
  }
  const resolved = resolveUrl(url) || PAGE.home();
  createView(winState, id, resolved, lazy);
});

ipcMain.on('switch-tab', (event, id) => {
  const winState = getWinState(event.sender);
  if (winState) switchView(winState, id);
});

ipcMain.on('close-tab', (event, id) => {
  const winState = getWinState(event.sender);
  if (winState) closeView(winState, id);
});

ipcMain.on('duplicate-tab', (event, id) => {
  const winState = getWinState(event.sender);
  if (!winState) return;
  const v = winState.views.get(id);
  if (!v || winState.views.size >= MAX_TABS) return;
  const newId = newTabId();
  const url = v.webContents.getURL() || PAGE.home();
  createView(winState, newId, url);
  winState.window.webContents.send('tab-duplicated', newId, url);
});

ipcMain.on('open-private-window', () => {
  createWindow(true);
});

ipcMain.on('show-tab-menu', (event, id, currentGroupId, groupsList) => {
  const winState = getWinState(event.sender);
  const isSleeping = sleepedTabs.has(id);
  const isActive = winState?.activeViewId === id;

  const addGroupSubmenu = [
    { label: 'New Group...', click: () => winState?.window.webContents.send('tab-menu-action', id, 'new-group') }
  ];

  if (groupsList && groupsList.length > 0) {
    addGroupSubmenu.push({ type: 'separator' });
    groupsList.forEach(g => {
      addGroupSubmenu.push({
        label: g.name,
        click: () => winState?.window.webContents.send('tab-menu-action', id, 'add-to-group', g.id)
      });
    });
  }

  const template = [
    { label: 'Duplicate Tab', click: () => winState?.window.webContents.send('tab-menu-action', id, 'duplicate') },
    { label: 'Reload Tab', click: () => {
        const v = winState?.views.get(id);
        if (v) v.webContents.reload();
      }
    },
    { type: 'separator' }
  ];

  if (isSleeping) {
    template.push({ label: 'Wake Tab', click: () => winState?.window.webContents.send('tab-menu-action', id, 'wake') });
  } else if (!isActive) {
    template.push({ label: 'Sleep Tab', click: () => winState?.window.webContents.send('tab-menu-action', id, 'sleep') });
  }

  template.push({ type: 'separator' });
  template.push({ label: 'Add to Group', submenu: addGroupSubmenu });

  if (currentGroupId) {
    template.push({ label: 'Remove from Group', click: () => winState?.window.webContents.send('tab-menu-action', id, 'remove-from-group') });
  }

  template.push({ type: 'separator' });
  template.push({ label: 'Close Tab', click: () => winState?.window.webContents.send('tab-menu-action', id, 'close') });

  const menu = Menu.buildFromTemplate(template);
  menu.popup(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.on('show-context-menu', (event) => {
  const template = [
    { role: 'undo' },
    { role: 'redo' },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { type: 'separator' },
    { role: 'selectAll' }
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.on('show-folder-menu', (event, folderName) => {
  const template = [
    { label: `New Note in ${folderName}`, click: () => event.sender.send('note-action', { type: 'new-note', folder: folderName }) },
    { type: 'separator' },
    { label: 'Rename Folder', click: () => event.sender.send('note-action', { type: 'rename-folder', folder: folderName }) },
    { label: 'Delete Folder', click: () => event.sender.send('note-action', { type: 'delete-folder', folder: folderName }) }
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.on('show-note-menu', (event, noteId) => {
  const template = [
    { label: 'Rename Note', click: () => event.sender.send('note-action', { type: 'rename-note', id: noteId }) },
    { label: 'Delete Note', click: () => event.sender.send('note-action', { type: 'delete-note', id: noteId }) },
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.on('navigate', (event, url) => {
  const winState = getWinState(event.sender);
  if (!winState) return;
  const id = winState.activeViewId;
  const v = winState.views.get(id);
  if (!v) return;
  const resolved = resolveUrl(url);
  if (!resolved) return;

  const currentUrl = v.webContents.getURL() || '';
  const isCurrentlyInternal = currentUrl === '' || currentUrl.startsWith('file://') || currentUrl.startsWith('kiyo://');
  const isNavigatingExternal = resolved.startsWith('http://') || resolved.startsWith('https://');

  if (isCurrentlyInternal && isNavigatingExternal) {
    winState.window.contentView.removeChildView(v);
    winState.views.delete(id);
    viewToWindow.delete(v.webContents.id);
    v.webContents.destroy();

    createView(winState, id, resolved);
    switchView(winState, id);
  } else {
    v.webContents.loadURL(resolved).catch(e => console.error('[kiyo]', e.message));
  }
});

ipcMain.on('find-in-page', (event, text, options) => {
  const winState = getWinState(event.sender);
  const v = winState?.views.get(winState.activeViewId);
  if (v) v.webContents.findInPage(text, options);
});

ipcMain.on('stop-find-in-page', (event, action) => {
  const winState = getWinState(event.sender);
  const v = winState?.views.get(winState.activeViewId);
  if (v) v.webContents.stopFindInPage(action);
});

ipcMain.on('set-zoom', (event, level) => {
  const winState = getWinState(event.sender);
  const v = winState?.views.get(winState.activeViewId);
  if (v) v.webContents.setZoomLevel(level);
});

ipcMain.handle('get-zoom', (event) => {
  const winState = getWinState(event.sender);
  const v = winState?.views.get(winState.activeViewId);
  return v ? v.webContents.getZoomLevel() : 0;
});

ipcMain.on('go-back', (event) => {
  const winState = getWinState(event.sender);
  const v = winState?.views.get(winState.activeViewId);
  if (v?.webContents.canGoBack()) v.webContents.goBack();
});
ipcMain.on('go-forward', (event) => {
  const winState = getWinState(event.sender);
  const v = winState?.views.get(winState.activeViewId);
  if (v?.webContents.canGoForward()) v.webContents.goForward();
});
ipcMain.on('reload', (event) => {
  const winState = getWinState(event.sender);
  const v = winState?.views.get(winState.activeViewId);
  if (v) v.webContents.reload();
});

const saveSessionDebounced = debounce((data) => writeJSON(SESSION_PATH, data), 500);

ipcMain.on('save-session', (event, sessionData) => {
  const winState = getWinState(event.sender);
  if (winState && !winState.isPrivate) {
    saveSessionDebounced(sessionData);
  }
});

ipcMain.handle('get-autocomplete', async (_, text) => {
  if (!text || text.length < 2) return [];
  const q = text.toLowerCase();
  const results = [];

  // Search Bookmarks
  bookmarks.forEach(bm => {
    if (bm.title.toLowerCase().includes(q) || bm.url.toLowerCase().includes(q)) {
      results.push({ title: bm.title, url: bm.url, type: 'bookmark' });
    }
  });

  // Search History
  history.forEach(h => {
    if (results.length >= 10) return;
    if (results.some(r => r.url === h.url)) return;
    if (h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)) {
      results.push({ title: h.title, url: h.url, type: 'history' });
    }
  });

  // Search Engine Suggestions (Fetch from Google)
  try {
    const response = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(text)}`);
    const data = await response.json();
    if (data && data[1]) {
      data[1].forEach(suggestion => {
        if (results.length >= 10) return;
        results.push({ title: suggestion, url: suggestion, type: 'search' });
      });
    }
  } catch (e) {
    console.error('[kiyo] suggest error:', e.message);
  }

  return results.slice(0, 10);
});

ipcMain.handle('extract-article', async (_, tabId) => {
  for (const winState of windows.values()) {
    const view = winState.views.get(tabId);
    if (view) {
      const url = view.webContents.getURL();
      try {
        const html = await view.webContents.executeJavaScript('document.documentElement.outerHTML');
        const article = await extractArticle(html, url);
        return { ...article, url, isArticle: isArticlePage(html) };
      } catch (e) {
        console.error('[kiyo] extract-article error:', e.message);
        return null;
      }
    }
  }
  return null;
});

ipcMain.handle('check-reader-mode', async (_, tabId) => {
  for (const winState of windows.values()) {
    const view = winState.views.get(tabId);
    if (view) {
      try {
        const html = await view.webContents.executeJavaScript('document.documentElement.outerHTML');
        return isArticlePage(html);
      } catch (e) {
        return false;
      }
    }
  }
  return false;
});

ipcMain.handle('pw-is-setup', () => pwManager.isSetup());
ipcMain.handle('pw-is-unlocked', () => pwManager.isUnlocked());
ipcMain.handle('pw-setup', (_, pass) => pwManager.setMasterPassword(pass));
ipcMain.handle('pw-unlock', (_, pass) => pwManager.unlock(pass));
ipcMain.on('pw-lock', () => pwManager.lock());
ipcMain.handle('pw-save', (_, domain, username, password) => pwManager.save(domain, username, password));
ipcMain.handle('pw-get', (_, domain) => pwManager.get(domain));
ipcMain.handle('pw-get-all', () => pwManager.getAll());
ipcMain.handle('pw-delete', (_, domain, username) => pwManager.delete(domain, username));
ipcMain.handle('pw-search', (_, q) => pwManager.search(q));

ipcMain.on('pw-captured', (event, domain, username, password) => {
  pendingCredentials.set(event.sender.id, { domain, username, password });
});

ipcMain.handle('pw-save-pending', (event, tabId) => {
  const winState = getWinState(event.sender);
  const view = winState?.views.get(tabId);
  if (!view) return false;
  const pending = pendingCredentials.get(view.webContents.id);
  if (pending && pwManager.isUnlocked()) {
    pwManager.save(pending.domain, pending.username, pending.password);
    pendingCredentials.delete(view.webContents.id);
    return true;
  }
  return false;
});

ipcMain.on('pw-discard-pending', (event, tabId) => {
  const winState = getWinState(event.sender);
  const view = winState?.views.get(tabId);
  if (view) {
    pendingCredentials.delete(view.webContents.id);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function broadcast(channel, ...args) {
  for (const winState of windows.values()) {
    winState.window.webContents.send(channel, ...args);
    for (const v of winState.views.values()) {
      try { 
        const url = v.webContents.getURL();
        if (!url || url.startsWith('file://')) v.webContents.send(channel, ...args);
      } catch { }
    }
  }
}

function getWinState(sender) {
  if (!sender) return null;
  return windows.get(sender.id) || viewToWindow.get(sender.id);
}

function createView(winState, id, url, lazy = false) {
  const isInternal = url.startsWith('file://') || url.startsWith('kiyo://');
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // OS Sandbox breaks spellchecker IPC for dictionary suggestions
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      partition: winState.partitionId,
      spellcheck: true,
      enableWebSQL: isInternal,
    },
  });

  winState.views.set(id, view);
  viewToWindow.set(view.webContents.id, winState);
  
  if (lazy) {
    view.pendingUrl = url;
  } else {
    view.webContents.loadURL(url).catch(e => console.error('[kiyo] view load:', e.message));
  }

  view.webContents.on('page-favicon-updated', (_, favs) => {
    if (favs?.length) winState.window.webContents.send('favicon-changed', id, favs[0]);
  });

  bindCosmeticFilters(view.webContents);

  view.webContents.on('found-in-page', (event, result) => {
    winState.window.webContents.send('found-in-page', result);
  });

  view.webContents.on('context-menu', (event, params) => {
    const { clipboard } = require('electron');
    const template = [];

    // Spelling suggestions
    if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
      for (const suggestion of params.dictionarySuggestions) {
        template.push({
          label: suggestion,
          click: () => view.webContents.replaceMisspelling(suggestion)
        });
      }
      template.push({ type: 'separator' });
    } else if (params.misspelledWord) {
      template.push({ label: 'No Suggestions', enabled: false });
      template.push({ type: 'separator' });
    }

    // Link Options
    if (params.linkURL) {
      template.push({
        label: 'Open Link in New Tab',
        click: () => {
          const newId = newTabId();
          createView(winState, newId, params.linkURL);
          winState.window.webContents.send('tab-duplicated', newId, params.linkURL);
        }
      });
      template.push({
        label: 'Copy Link Address',
        click: () => clipboard.writeText(params.linkURL)
      });
      template.push({ type: 'separator' });
    }

    // Media Options
    if (params.mediaType === 'image') {
      template.push({ role: 'copyImage', label: 'Copy Image' });
      template.push({ label: 'Copy Image URL', click: () => clipboard.writeText(params.srcURL) });
      template.push({ type: 'separator' });
    }

    // Edit Options
    if (params.editFlags.canCut) template.push({ role: 'cut' });
    if (params.editFlags.canCopy) template.push({ role: 'copy' });
    if (params.editFlags.canPaste) template.push({ role: 'paste' });
    
    // Default actions if no selection/link
    if (!params.linkURL && !params.selectionText && params.mediaType === 'none') {
      template.push({ role: 'reload' });
      template.push({ role: 'selectAll' });
    }
    
    template.push({ type: 'separator' });
    template.push({ label: 'Inspect Element', click: () => view.webContents.inspectElement(params.x, params.y) });

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: winState.window });
  });

  view.webContents.on('did-navigate', async (_, u) => {
    const uiUrl = getUIUrl(u);
    winState.window.webContents.send('url-changed', id, uiUrl);
    if (winState.activeViewId === id) pushHistory(u, '', winState.isPrivate);

    // Only prompt to save if credentials were actually captured from a form
    // submission on this tab. Without this guard the dialog fires on every
    // navigation, even when no password was ever entered.
    if (!pendingCredentials.has(view.webContents.id)) return;
    let domain;
    try { domain = new URL(u).hostname; } catch { return; }
    winState.window.webContents.send('pw-check-save-prompt', id, domain);
  });

  view.webContents.on('did-finish-load', async () => {
    const url = view.webContents.getURL();
    let domain;
    try { domain = new URL(url).hostname; } catch { return; }
    if (!pwManager.isUnlocked()) return;
    const creds = await pwManager.get(domain);
    if (!creds.length) return;
    // Inject autofill helper
    view.webContents.executeJavaScript(`
      (function() {
        const creds = ${JSON.stringify(creds)};
        const pwField = document.querySelector('input[type="password"]');
        const userField = pwField && (
          document.querySelector('input[type="email"]') ||
          document.querySelector('input[type="text"][autocomplete*="user"]') ||
          document.querySelector('input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"]')
        );
        if (pwField && creds[0]) {
          pwField.value = creds[0].password;
          if (userField) userField.value = creds[0].username;
          // Dispatch input events so React/Vue forms detect the fill
          [pwField, userField].filter(Boolean).forEach(el => {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
      })();
    `);
  });

  view.webContents.on('did-navigate-in-page', (_, u, isMainFrame) => {
    winState.window.webContents.send('url-changed', id, getUIUrl(u));
    if (isMainFrame && winState.activeViewId === id && !u.startsWith('file://')) {
      pushHistory(u, view.webContents.getTitle(), winState.isPrivate);
    }
  });

  view.webContents.on('page-title-updated', (_, title) => {
    let t = title;
    if (t.includes('newtab.html')) t = 'Home';
    winState.window.webContents.send('title-changed', id, t);
    
    if (!winState.isPrivate) {
      const currentUrl = view.webContents.getURL();
      if (currentUrl && !currentUrl.startsWith('file://')) {
        const entry = history.find(h => h.url === currentUrl && (!h.title || h.title === ''));
        if (entry) { entry.title = title; saveHistory(); }
      }
    }
  });

  view.webContents.on('did-start-loading', () => winState.window.webContents.send('loading-status', id, true));
  view.webContents.on('did-stop-loading', () => winState.window.webContents.send('loading-status', id, false));

  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) { // Skip cancelled requests
      const errorPage = `${PAGE.error()}?url=${encodeURIComponent(validatedURL)}&code=${errorCode}&desc=${encodeURIComponent(errorDescription)}`;
      view.webContents.loadURL(errorPage).catch(() => {});
    }
  });

  if (!lazy) {
    switchView(winState, id);
  }
}

function scheduleTabSleep(winState, id) {
  if (tabSleepTimers.has(id)) {
    clearTimeout(tabSleepTimers.get(id));
    tabSleepTimers.delete(id);
  }
  if (!settings.tabSleepEnabled || id === winState.activeViewId) return;

  const timer = setTimeout(() => {
    sleepTab(winState, id);
  }, settings.tabSleepDelay * 60 * 1000);
  tabSleepTimers.set(id, timer);
}

function sleepTab(winState, id) {
  if (id === winState.activeViewId) return;
  const view = winState.views.get(id);
  if (!view) return;

  sleepedTabs.set(id, {
    url: view.webContents.getURL() || view.pendingUrl,
    title: view.webContents.getTitle(),
    favicon: null
  });

  try { winState.window.contentView.removeChildView(view); } catch(e) {}
  viewToWindow.delete(view.webContents.id);
  view.webContents.destroy();
  winState.views.delete(id);

  winState.window.webContents.send('tab-slept', id);
  console.log('[kiyo] Tab slept:', id);
}

function wakeTab(winState, id) {
  const data = sleepedTabs.get(id);
  if (!data) return;
  sleepedTabs.delete(id);
  createView(winState, id, data.url);
  winState.window.webContents.send('tab-woke', id, data.url);
}

function switchView(winState, id) {
  if (sleepedTabs.has(id)) {
    wakeTab(winState, id);
    return;
  }

  const prevId = winState.activeViewId;

  if (winState.activeViewId && winState.views.has(winState.activeViewId)) {
    winState.window.contentView.removeChildView(winState.views.get(winState.activeViewId));
  }
  winState.activeViewId = id;
  const v = winState.views.get(id);
  if (v) {
    if (v.pendingUrl) {
      v.webContents.loadURL(v.pendingUrl).catch(e => console.error('[kiyo] view load:', e.message));
      v.pendingUrl = null;
    }
    winState.window.contentView.addChildView(v);
    updateActiveViewBounds(winState);
    winState.window.webContents.send('url-changed', id, getUIUrl(v.webContents.getURL() || v.pendingUrl || ''));
  }

  if (prevId && prevId !== id && winState.views.has(prevId)) {
    scheduleTabSleep(winState, prevId);
  }

  if (tabSleepTimers.has(id)) {
    clearTimeout(tabSleepTimers.get(id));
    tabSleepTimers.delete(id);
  }
}

function closeView(winState, id) {
  if (tabSleepTimers.has(id)) {
    clearTimeout(tabSleepTimers.get(id));
    tabSleepTimers.delete(id);
  }
  sleepedTabs.delete(id);

  const v = winState.views.get(id);
  if (!v) return;
  if (winState.activeViewId === id) {
    winState.window.contentView.removeChildView(v);
    winState.activeViewId = null;
  }
  viewToWindow.delete(v.webContents.id);
  v.webContents.destroy();
  winState.views.delete(id);
}

function updateActiveViewBounds(winState) {
  if (!winState.window || !winState.activeViewId) return;
  const v = winState.views.get(winState.activeViewId);
  if (!v) return;
  const { width, height } = winState.window.getContentBounds();
  const { sidebarWidth, headerHeight } = settings.geometry;
  v.setBounds({
    x: Math.round(sidebarWidth),
    y: Math.round(headerHeight),
    width: Math.max(1, Math.round(width - sidebarWidth)),
    height: Math.max(1, Math.round(height - headerHeight)),
  });
}

function setupAdblock(sess) {
  sess.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const url = details.url;
    if (url.startsWith('kiyo://') || url.startsWith('file://')) {
      return callback({ cancel: false });
    }

    if (settings.blockHyperlinkAuditing && details.resourceType === 'ping') {
      adblock.incrementStats();
      return callback({ cancel: true });
    }

    if (settings.adblockEnabled && adblock.shouldBlock(url, details.resourceType)) {
      adblock.incrementStats();
      return callback({ cancel: true });
    }

    try {
      const { isDomainBlocked } = require('./lib/privacy');
      const hostname = new URL(url).hostname;
      if (settings.adblockEnabled && isDomainBlocked(hostname)) {
        adblock.incrementStats();
        return callback({ cancel: true });
      }
    } catch (e) {}

    callback({ cancel: false });
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  loadSettings();
  loadBookmarks();
  loadHistory();
  adblock.initAdblock();

  const defaultUA = session.defaultSession.getUserAgent();
  const cleanUA = defaultUA.replace(/kiyo\/[0-9\.-]+\s?/, '').replace(/Electron\/[0-9\.-]+\s?/, '');
  app.userAgentFallback = cleanUA;

  createWindow();

  // Apply Shield to default session too
  setupPrivacyShield(session.defaultSession);
  setupAdblock(session.defaultSession);

  // Enable Spellchecker globally
  session.defaultSession.setSpellCheckerEnabled(true);
  session.defaultSession.setSpellCheckerLanguages(['en-US']);

  // Local Shortcuts (Intercepted at WebContents level)
  const shortcuts = {
    't': (win) => win.webContents.send('shortcut', 'new-tab'),
    'n': (win, e) => { if (e.shift) ipcMain.emit('open-private-window'); },
    'w': (win) => win.webContents.send('shortcut', 'close-tab'),
    'l': (win) => win.webContents.send('shortcut', 'focus-url'),
    'r': (win, e) => {
      const winState = windows.get(win.webContents.id);
      const v = winState?.views.get(winState.activeViewId);
      if (e && e.shift) {
        win.webContents.send('shortcut', 'toggle-reader');
      } else {
        if (v) v.webContents.reload();
      }
    },
    'f': (win) => win.webContents.send('shortcut', 'open-find'),
    'i': (win, e) => {
      if (e.shift) {
        const winState = windows.get(win.webContents.id) || Array.from(windows.values()).find(s => s.window === win);
        const v = winState?.views.get(winState?.activeViewId);
        if (v) v.webContents.toggleDevTools({ mode: 'detach' });
        else win.webContents.toggleDevTools({ mode: 'detach' });
      }
    },
    '=': (win) => win.webContents.send('shortcut', 'zoom-in'),
    '-': (win) => win.webContents.send('shortcut', 'zoom-out'),
    '0': (win) => win.webContents.send('shortcut', 'zoom-reset'),
    'k': (win, e) => { if (e.shift) win.webContents.send('shortcut', 'tab-search'); },
    'p': (win, e) => { if (e.shift) win.webContents.send('shortcut', 'open-passwords'); },
  };

  app.on('web-contents-created', (_, wc) => {
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.control || input.meta)) {
        const key = input.key.toLowerCase();
        const winState = getWinState(wc);
        const win = winState ? winState.window : BrowserWindow.getFocusedWindow();
        if (win && shortcuts[key]) {
          shortcuts[key](win, input);
          event.preventDefault();
        }
      }
    });
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
