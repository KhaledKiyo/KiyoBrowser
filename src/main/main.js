const { app, BrowserWindow, WebContentsView, ipcMain, globalShortcut, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const {
  MAX_DOWNLOADS_HISTORY,
  MAX_TABS,
  MAX_HISTORY_ENTRIES,
  MAX_BOOKMARKS,
  newTabId,
} = require('./constants');

// ─── Internal page URLs ───────────────────────────────────────────────────────
const PAGE = {
  home: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'newtab', 'newtab.html'),
  settings: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'settings', 'settings.html'),
  downloads: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'downloads', 'downloads.html'),
  bookmarks: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'bookmarks', 'bookmarks.html'),
  history: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'history', 'history.html'),
};

function normaliseFileUrl(u) {
  try {
    const obj = new URL(u);
    return obj.protocol + '//' + obj.pathname;
  } catch { return u; }
}

// ─── Global State ─────────────────────────────────────────────────────────────
const windows = new Map(); // webContents.id -> { window, views, activeViewId, isPrivate, partitionId }
const viewToWindow = new Map(); // webContents.id -> winState
const downloads = [];

const DATA_DIR = app.getPath('userData');
const SETTINGS_PATH = path.join(DATA_DIR, 'kiyo-settings.json');
const SESSION_PATH = path.join(DATA_DIR, 'kiyo-session.json');
const BOOKMARKS_PATH = path.join(DATA_DIR, 'kiyo-bookmarks.json');
const HISTORY_PATH = path.join(DATA_DIR, 'kiyo-history.json');
const QUICKLINKS_PATH = path.join(DATA_DIR, 'kiyo-quicklinks.json');

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

// ─── Private Session Manager ──────────────────────────────────────────────────
const PrivateSessionManager = {
  currentPartitionId: null,
  activePrivateWindows: 0,

  getPartitionId() {
    if (!this.currentPartitionId) {
      this.currentPartitionId = `incognito-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    }
    return this.currentPartitionId;
  },

  increment() { this.activePrivateWindows++; },
  decrement() {
    this.activePrivateWindows--;
    if (this.activePrivateWindows <= 0) {
      this.activePrivateWindows = 0;
      this.cleanup();
    }
  },

  async cleanup() {
    if (!this.currentPartitionId) return;
    const sess = session.fromPartition(this.currentPartitionId);
    await sess.clearStorageData();
    await sess.clearCache();
    console.log('[kiyo] Private session cleared:', this.currentPartitionId);
    this.currentPartitionId = null;
  }
};

// ─── Persistence helpers ──────────────────────────────────────────────────────
function readJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { console.warn('[kiyo] read failed:', filePath, e.message); }
  return fallback;
}

function writeJSON(filePath, data) {
  try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('[kiyo] write failed:', filePath, e.message); }
}

function loadSettings() {
  const raw = readJSON(SETTINGS_PATH, {});
  for (const [key, validate] of Object.entries(SETTING_SCHEMA)) {
    if (key in raw && validate(raw[key])) settings[key] = raw[key];
  }
}
function saveSettings() { writeJSON(SETTINGS_PATH, settings); }
function loadBookmarks() { bookmarks = readJSON(BOOKMARKS_PATH, []); }
function saveBookmarks() { writeJSON(BOOKMARKS_PATH, bookmarks); }
function loadHistory() { history = readJSON(HISTORY_PATH, []); }
function saveHistory() { writeJSON(HISTORY_PATH, history); }

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
  if (isPrivate) return; // Never record in history for private windows
  if (!url || url.startsWith('kiyo://') || url.startsWith('file://')) return;
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

  const winState = {
    window: win,
    views: new Map(),
    activeViewId: null,
    isPrivate,
    partitionId: isPrivate ? PrivateSessionManager.getPartitionId() : undefined
  };
  windows.set(win.webContents.id, winState);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'ui', 'index.html'));
  win.on('resize', () => updateActiveViewBounds(winState));

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
      view.webContents.destroy();
    }
    windows.delete(win.webContents.id);
    if (isPrivate) PrivateSessionManager.decrement();
  });

  // ── Download tracking ────────────────────────────────────────────────────────
  win.webContents.session.on('will-download', (_, item) => {
    if (isPrivate) return; // Skip history for private downloads
    const name = item.getFilename();
    if (downloads.length >= MAX_DOWNLOADS_HISTORY) downloads.splice(0, 1);
    const obj = { name, progress: 0, state: 'progressing', startedAt: Date.now() };
    downloads.push(obj);
    win.webContents.send('download-started', name);

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

ipcMain.on('update-setting', (event, key, value) => {
  if (!SETTING_SCHEMA[key] || !SETTING_SCHEMA[key](value)) return;
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

ipcMain.on('create-tab', (event, id, url) => {
  const winState = getWinState(event.sender);
  if (!winState) return;
  if (winState.views.size >= MAX_TABS) {
    winState.window.webContents.send('tab-limit-reached');
    return;
  }
  const resolved = resolveUrl(url) || PAGE.home();
  createView(winState, id, resolved);
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

const { Menu } = require('electron');
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

ipcMain.on('navigate', (event, url) => {
  const winState = getWinState(event.sender);
  if (!winState) return;
  const v = winState.views.get(winState.activeViewId);
  if (!v) return;
  const resolved = resolveUrl(url);
  if (resolved) v.webContents.loadURL(resolved).catch(e => console.error('[kiyo]', e.message));
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

ipcMain.on('save-session', (event, sessionData) => {
  const winState = getWinState(event.sender);
  if (winState && !winState.isPrivate) {
    writeJSON(SESSION_PATH, sessionData);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function broadcast(channel, ...args) {
  for (const winState of windows.values()) {
    winState.window.webContents.send(channel, ...args);
    for (const v of winState.views.values()) {
      try { v.webContents.send(channel, ...args); } catch { }
    }
  }
}

function getWinState(sender) {
  if (!sender) return null;
  return windows.get(sender.id) || viewToWindow.get(sender.id);
}

function createView(winState, id, url) {
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      partition: winState.partitionId,
    },
  });

  winState.views.set(id, view);
  viewToWindow.set(view.webContents.id, winState);
  view.webContents.loadURL(url).catch(e => console.error('[kiyo] view load:', e.message));

  view.webContents.on('page-favicon-updated', (_, favs) => {
    if (favs?.length) winState.window.webContents.send('favicon-changed', id, favs[0]);
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

  switchView(winState, id);
}

function switchView(winState, id) {
  if (winState.activeViewId && winState.views.has(winState.activeViewId)) {
    winState.window.contentView.removeChildView(winState.views.get(winState.activeViewId));
  }
  winState.activeViewId = id;
  const v = winState.views.get(id);
  if (v) {
    winState.window.contentView.addChildView(v);
    updateActiveViewBounds(winState);
    winState.window.webContents.send('url-changed', id, getUIUrl(v.webContents.getURL()));
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

  // Global Shortcuts
  const shortcuts = {
    'CommandOrControl+T': () => BrowserWindow.getFocusedWindow()?.webContents.send('shortcut', 'new-tab'),
    'CommandOrControl+Shift+N': () => ipcMain.emit('open-private-window'),
    'CommandOrControl+W': () => BrowserWindow.getFocusedWindow()?.webContents.send('shortcut', 'close-tab'),
    'CommandOrControl+L': () => BrowserWindow.getFocusedWindow()?.webContents.send('shortcut', 'focus-url'),
    'CommandOrControl+R': () => {
      const winState = windows.get(BrowserWindow.getFocusedWindow()?.webContents.id);
      const v = winState?.views.get(winState.activeViewId);
      if (v) v.webContents.reload();
    },
  };
  for (const [accel, fn] of Object.entries(shortcuts)) globalShortcut.register(accel, fn);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
