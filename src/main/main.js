const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── Modules ──────────────────────────────────────────────────────────────────
const { PrivateSessionManager } = require('./lib/session');
const { bindCosmeticFilters } = require('./lib/privacy');
const { readJSON, writeJSON } = require('./lib/utils');
const { ElectronBlocker } = require('@cliqz/adblocker-electron');
const fetch = require('cross-fetch');

let sharedBlocker = null;
async function setupAdBlocker(targetSession) {
  try {
    if (!sharedBlocker) {
      sharedBlocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
    }
    sharedBlocker.enableBlockingInSession(targetSession);
  } catch (e) {
    console.error('[kiyo-adblock] Error:', e.message);
  }
}

// ─── App config ───────────────────────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
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

const SETTINGS_DEFAULTS = {
  theme: 'default',
  blurIntensity: 25,
  tabStyle: 'squircle',
  searchEngine: 'google',
  geometry: { sidebarWidth: 72, headerHeight: 60 },
};

const SETTING_SCHEMA = {
  theme: v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v),
  blurIntensity: v => typeof v === 'number' && v >= 0 && v <= 60,
  tabStyle: v => ['squircle', 'square', 'circle'].includes(v),
  searchEngine: v => ['google', 'bing', 'duckduckgo'].includes(v),
  geometry: v => v && typeof v.sidebarWidth === 'number' && typeof v.headerHeight === 'number',
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

  if (/^https?:\/\//i.test(t)) return t;

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
      partition: isPrivate ? PrivateSessionManager.getPartitionId() : undefined,
    },
  });

  bindCosmeticFilters(win.webContents);
  
  // Apply Ad Blocker to this window's session
  setupAdBlocker(win.webContents.session);

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
    isPrivate: winState.isPrivate
  };
});

ipcMain.handle('get-settings', () => settings);

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

ipcMain.on('show-tab-menu', (event, id) => {
  const winState = getWinState(event.sender);
  const template = [
    { label: 'Duplicate Tab', click: () => winState?.window.webContents.send('tab-menu-action', id, 'duplicate') },
    { label: 'Reload Tab', click: () => {
        const v = winState?.views.get(id);
        if (v) v.webContents.reload();
      }
    },
    { type: 'separator' },
    { label: 'Close Tab', click: () => winState?.window.webContents.send('tab-menu-action', id, 'close') }
  ];
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
  const v = winState.views.get(winState.activeViewId);
  if (!v) return;
  const resolved = resolveUrl(url);
  if (resolved) v.webContents.loadURL(resolved).catch(e => console.error('[kiyo]', e.message));
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
      sandbox: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      partition: winState.partitionId,
      spellcheck: isInternal,
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

  view.webContents.on('did-navigate', (_, u) => {
    const uiUrl = getUIUrl(u);
    winState.window.webContents.send('url-changed', id, uiUrl);
    if (winState.activeViewId === id) pushHistory(u, '', winState.isPrivate);
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

  switchView(winState, id);
}

function switchView(winState, id) {
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
}

function closeView(winState, id) {
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

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  loadSettings();
  loadBookmarks();
  loadHistory();

  const defaultUA = session.defaultSession.getUserAgent();
  const cleanUA = defaultUA.replace(/kiyo\/[0-9\.-]+\s?/, '').replace(/Electron\/[0-9\.-]+\s?/, '');
  app.userAgentFallback = cleanUA;

  createWindow();

  // Apply Shield to default session too
  setupAdBlocker(session.defaultSession);

  // Local Shortcuts (Intercepted at WebContents level)
  const shortcuts = {
    't': (win) => win.webContents.send('shortcut', 'new-tab'),
    'n': (win, e) => { if (e.shift) ipcMain.emit('open-private-window'); },
    'w': (win) => win.webContents.send('shortcut', 'close-tab'),
    'l': (win) => win.webContents.send('shortcut', 'focus-url'),
    'r': (win, e) => {
      const winState = windows.get(win.webContents.id);
      const v = winState?.views.get(winState.activeViewId);
      if (v) {
        if (e && e.shift) v.webContents.reloadIgnoringCache();
        else v.webContents.reload();
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
