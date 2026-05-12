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

// Normalise a file:// URL — strip query/hash/trailing slash for alias matching
function normaliseFileUrl(u) {
  try {
    const obj = new URL(u);
    return obj.protocol + '//' + obj.pathname;
  } catch { return u; }
}

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow;
const views = new Map();
let activeViewId = null;
const downloads = [];

const DATA_DIR = app.getPath('userData');
const SETTINGS_PATH = path.join(DATA_DIR, 'kiyo-settings.json');
const SESSION_PATH = path.join(DATA_DIR, 'kiyo-session.json');
const BOOKMARKS_PATH = path.join(DATA_DIR, 'kiyo-bookmarks.json');
const HISTORY_PATH = path.join(DATA_DIR, 'kiyo-history.json');

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
  alias = alias.replace(/\/$/, ''); // Remove trailing slash
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
function pushHistory(url, title) {
  // Don't record internal kiyo:// pages or blank
  if (!url || url.startsWith('kiyo://') || url.startsWith('file://')) return;
  const entry = { url, title: title || url, visitedAt: Date.now() };
  history.unshift(entry);
  if (history.length > MAX_HISTORY_ENTRIES) history.splice(MAX_HISTORY_ENTRIES);
  saveHistory();
  broadcast('history-updated');
}

// ─── Window creation ──────────────────────────────────────────────────────────
function createWindow() {
  loadSettings();
  loadBookmarks();
  loadHistory();

  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 800, minHeight: 500,
    backgroundColor: '#0a0b10',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'ui', 'index.html'));
  mainWindow.on('resize', updateActiveViewBounds);

  // ── CSP ─────────────────────────────────────────────────────────────────────
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' file:; " +
          "script-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "img-src * data:; " +
          "connect-src 'none';",
        ],
      },
    });
  });

  // ── IPC: Ready handshake (fixes boot race) ───────────────────────────────────
  ipcMain.handle('renderer-ready', () => {
    const session = readJSON(SESSION_PATH, null);
    return {
      settings,
      maxTabs: MAX_TABS,
      session,   // null if none saved
    };
  });

  // ── IPC: Settings ───────────────────────────────────────────────────────────
  ipcMain.handle('get-settings', () => settings);

  ipcMain.on('update-setting', (event, key, value) => {
    if (!SETTING_SCHEMA[key] || !SETTING_SCHEMA[key](value)) {
      console.warn('[kiyo] Rejected invalid setting:', key, value);
      return;
    }
    settings[key] = value;
    saveSettings();
    broadcast('theme-updated', settings);
  });

  ipcMain.on('update-geometry', (event, geometry) => {
    if (SETTING_SCHEMA.geometry(geometry)) {
      settings.geometry = geometry;
      updateActiveViewBounds();
    }
  });

  // ── IPC: Downloads ──────────────────────────────────────────────────────────
  ipcMain.handle('get-downloads', () => downloads);
  ipcMain.on('clear-downloads', () => {
    downloads.splice(0);
    broadcast('downloads-cleared');
  });

  // ── IPC: Bookmarks ──────────────────────────────────────────────────────────
  ipcMain.handle('get-bookmarks', () => bookmarks);

  ipcMain.on('add-bookmark', (_, bookmark) => {
    if (!bookmark || typeof bookmark.url !== 'string') return;
    if (bookmarks.some(b => b.url === bookmark.url)) return; // deduplicate
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

  // ── IPC: History ─────────────────────────────────────────────────────────────
  ipcMain.handle('get-history', () => history);
  ipcMain.on('clear-history', () => {
    history = [];
    saveHistory();
    broadcast('history-updated');
  });
  ipcMain.on('remove-history-entry', (_, url) => {
    history = history.filter(h => h.url !== url);
    saveHistory();
    broadcast('history-updated');
  });

  // ── IPC: Themes ─────────────────────────────────────────────────────────────
  ipcMain.handle('get-available-themes', () => {
    const themesPath = path.join(__dirname, '..', 'renderer', 'themes');
    if (!fs.existsSync(themesPath)) return [];
    return fs.readdirSync(themesPath)
      .filter(f => f.endsWith('.css'))
      .map(f => {
        const name = f.replace('.css', '');
        // Try meta.json in same dir for richer info
        const metaPath = path.join(themesPath, name, 'meta.json');
        if (fs.existsSync(metaPath)) {
          try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { }
        }
        // Fall back to filename-derived meta
        return { id: name, name: name.charAt(0).toUpperCase() + name.slice(1), accentColor: null };
      });
  });

  // ── IPC: Tabs ───────────────────────────────────────────────────────────────
  ipcMain.on('create-tab', (event, id, url) => {
    if (views.size >= MAX_TABS) {
      mainWindow.webContents.send('tab-limit-reached');
      return;
    }
    const resolved = resolveUrl(url) || PAGE.home();
    createView(id, resolved);
  });

  ipcMain.on('switch-tab', (_, id) => switchView(id));
  ipcMain.on('close-tab', (_, id) => closeView(id));
  ipcMain.on('duplicate-tab', (_, id) => {
    const v = views.get(id);
    if (!v || views.size >= MAX_TABS) return;
    const newId = newTabId();
    const url = v.webContents.getURL() || PAGE.home();
    createView(newId, url);
    mainWindow.webContents.send('tab-duplicated', newId, url);
  });

  const { Menu } = require('electron');
  ipcMain.on('show-tab-menu', (event, id) => {
    const template = [
      { label: 'Duplicate Tab', click: () => mainWindow.webContents.send('tab-menu-action', id, 'duplicate') },
      { label: 'Reload Tab', click: () => {
          const v = views.get(id);
          if (v) v.webContents.reload();
        }
      },
      { type: 'separator' },
      { label: 'Close Tab', click: () => mainWindow.webContents.send('tab-menu-action', id, 'close') }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup(BrowserWindow.fromWebContents(event.sender));
  });

  // ── IPC: Navigation ─────────────────────────────────────────────────────────
  ipcMain.on('navigate', (_, url) => {
    const v = views.get(activeViewId);
    if (!v) return;
    const resolved = resolveUrl(url);
    if (!resolved) { console.warn('[kiyo] Blocked:', url); return; }
    v.webContents.loadURL(resolved).catch(e => console.error('[kiyo]', e.message));
  });

  ipcMain.on('go-back', () => { const v = views.get(activeViewId); if (v?.webContents.canGoBack()) v.webContents.goBack(); });
  ipcMain.on('go-forward', () => { const v = views.get(activeViewId); if (v?.webContents.canGoForward()) v.webContents.goForward(); });
  ipcMain.on('reload', () => { const v = views.get(activeViewId); if (v) v.webContents.reload(); });

  // ── IPC: Session save/restore ────────────────────────────────────────────────
  ipcMain.on('save-session', (_, sessionData) => {
    writeJSON(SESSION_PATH, sessionData);
  });

  // ── Download tracking ────────────────────────────────────────────────────────
  mainWindow.webContents.session.on('will-download', (_, item) => {
    const name = item.getFilename();
    if (downloads.length >= MAX_DOWNLOADS_HISTORY) downloads.splice(0, 1);
    const obj = { name, progress: 0, state: 'progressing', startedAt: Date.now() };
    downloads.push(obj);
    mainWindow.webContents.send('download-started', name);

    item.on('updated', (_, state) => {
      if (state === 'progressing') {
        const total = item.getTotalBytes();
        const prog = total > 0 ? item.getReceivedBytes() / total : 0;
        obj.progress = prog;
        mainWindow.webContents.send('download-progress', name, prog);
      }
    });
    item.once('done', (_, state) => {
      obj.state = state;
      obj.progress = 1;
      mainWindow.webContents.send('download-completed', name, state);
    });
  });

  // ── Global keyboard shortcuts ────────────────────────────────────────────────
  const shortcuts = {
    'CommandOrControl+T': () => mainWindow.webContents.send('shortcut', 'new-tab'),
    'CommandOrControl+W': () => mainWindow.webContents.send('shortcut', 'close-tab'),
    'CommandOrControl+L': () => mainWindow.webContents.send('shortcut', 'focus-url'),
    'CommandOrControl+R': () => { const v = views.get(activeViewId); if (v) v.webContents.reload(); },
    'CommandOrControl+Shift+R': () => { const v = views.get(activeViewId); if (v) v.webContents.reloadIgnoringCache(); },
    'Alt+Left': () => { const v = views.get(activeViewId); if (v?.webContents.canGoBack()) v.webContents.goBack(); },
    'Alt+Right': () => { const v = views.get(activeViewId); if (v?.webContents.canGoForward()) v.webContents.goForward(); },
    'CommandOrControl+Shift+J': () => mainWindow.webContents.send('shortcut', 'open-downloads'),
    'CommandOrControl+,': () => mainWindow.webContents.send('shortcut', 'open-settings'),
    'CommandOrControl+B': () => mainWindow.webContents.send('shortcut', 'open-bookmarks'),
    'CommandOrControl+H': () => mainWindow.webContents.send('shortcut', 'open-history'),
    'CommandOrControl+D': () => mainWindow.webContents.send('shortcut', 'toggle-bookmark'),
  };
  for (const [accel, fn] of Object.entries(shortcuts)) globalShortcut.register(accel, fn);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function broadcast(channel, ...args) {
  if (mainWindow) mainWindow.webContents.send(channel, ...args);
  for (const v of views.values()) {
    try { v.webContents.send(channel, ...args); } catch { }
  }
}

// ─── View management ──────────────────────────────────────────────────────────
function createView(id, url) {
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    },
  });

  views.set(id, view);
  view.webContents.loadURL(url).catch(e => console.error('[kiyo] view load:', e.message));

  view.webContents.on('page-favicon-updated', (_, favs) => {
    if (favs?.length) mainWindow.webContents.send('favicon-changed', id, favs[0]);
  });

  view.webContents.on('did-navigate', (_, u) => {
    const uiUrl = getUIUrl(u);
    mainWindow.webContents.send('url-changed', id, uiUrl);
    // Record history (title not yet available — updated on title event)
    if (activeViewId === id) {
      const title = view.webContents.getTitle();
      pushHistory(u, title);
    }
  });

  view.webContents.on('did-navigate-in-page', (_, u) => {
    mainWindow.webContents.send('url-changed', id, getUIUrl(u));
  });

  view.webContents.on('page-title-updated', (_, title) => {
    let t = title;
    if (t.includes('newtab.html')) t = 'Home';
    if (t.includes('settings.html')) t = 'Settings';
    if (t.includes('downloads.html')) t = 'Downloads';
    if (t.includes('bookmarks.html')) t = 'Bookmarks';
    if (t.includes('history.html')) t = 'History';
    mainWindow.webContents.send('title-changed', id, t);
  });

  view.webContents.on('did-start-loading', () => mainWindow.webContents.send('loading-status', id, true));
  view.webContents.on('did-stop-loading', () => mainWindow.webContents.send('loading-status', id, false));
  // Note: bounds are NOT updated here — only on resize or geometry change

  switchView(id);
}

function switchView(id) {
  if (activeViewId && views.has(activeViewId)) {
    mainWindow.contentView.removeChildView(views.get(activeViewId));
  }
  activeViewId = id;
  const v = views.get(id);
  if (v) {
    mainWindow.contentView.addChildView(v);
    updateActiveViewBounds();
    mainWindow.webContents.send('url-changed', id, getUIUrl(v.webContents.getURL()));
  }
}

function closeView(id) {
  const v = views.get(id);
  if (!v) return;
  if (activeViewId === id) {
    mainWindow.contentView.removeChildView(v);
    activeViewId = null;
  }
  v.webContents.destroy();
  views.delete(id);
}

function updateActiveViewBounds() {
  if (!mainWindow || !activeViewId) return;
  const v = views.get(activeViewId);
  if (!v) return;
  const { width, height } = mainWindow.getContentBounds();
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
  // Fix User-Agent to bypass Cloudflare
  const defaultUA = session.defaultSession.getUserAgent();
  const cleanUA = defaultUA.replace(/kiyo\/[0-9\.-]+\s?/, '').replace(/Electron\/[0-9\.-]+\s?/, '');
  app.userAgentFallback = cleanUA;

  // Clean User-Agent should be enough for most bot protections
  createWindow();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
