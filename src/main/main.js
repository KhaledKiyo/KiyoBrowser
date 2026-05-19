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
const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, globalShortcut, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const AdmZip = require('adm-zip');

// ─── Chromium Security Hardening Switches ──────────────────────────────────────
app.commandLine.appendSwitch('enable-sandbox');
app.commandLine.appendSwitch('site-per-process');
app.commandLine.appendSwitch('enable-strict-mixed-content-checking');
app.commandLine.appendSwitch('js-flags', '--max-semi-space-size=1024');

// ─── Modules ──────────────────────────────────────────────────────────────────
const { PrivateSessionManager } = require('./lib/session');
const { setupPrivacyShield, bindCosmeticFilters } = require('./lib/privacy');
const { readJSON, writeJSON } = require('./lib/utils');
const adblock = require('./adblock');
const { extractArticle, isArticlePage } = require('./readability');
const PasswordManager = require('./passwords');

// ─── App config ───────────────────────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
const EXTENSIONS_PATH = path.join(USER_DATA, 'kiyo-extensions');
if (!fs.existsSync(EXTENSIONS_PATH)) fs.mkdirSync(EXTENSIONS_PATH, { recursive: true });
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
  extensions: () => 'file://' + path.join(__dirname, '..', 'renderer', 'pages', 'extensions', 'extensions.html'),
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
let extensionsManager = null;
const pendingCredentials = new Map(); // wc.id -> { domain, username, password }
const readerArticles = new Map();     // tabId -> article data
const tabNavStack = new Map();        // tabId -> { stack: string[], index: number }

function isSameUrlRelaxed(urlA, urlB) {
  if (!urlA || !urlB) return false;
  if (urlA === urlB) return true;
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    
    const hostA = a.hostname.replace(/^www\./i, '');
    const hostB = b.hostname.replace(/^www\./i, '');
    if (hostA !== hostB) return false;
    
    const pathA = a.pathname.replace(/\/$/, '');
    const pathB = b.pathname.replace(/\/$/, '');
    if (pathA !== pathB) return false;
    
    if (a.search !== b.search) return false;
    return true;
  } catch {
    const cleanA = urlA.toLowerCase().replace(/\/$/, '');
    const cleanB = urlB.toLowerCase().replace(/\/$/, '');
    return cleanA === cleanB;
  }
}

function pushToNavStack(tabId, url) {
  if (!tabNavStack.has(tabId)) {
    tabNavStack.set(tabId, { stack: [url], index: 0 });
    return;
  }
  const state = tabNavStack.get(tabId);
  const { stack, index } = state;
  
  // Check if going back natively
  if (index > 0 && isSameUrlRelaxed(stack[index - 1], url)) {
    state.index = index - 1;
    return;
  }
  
  // Check if going forward natively
  if (index < stack.length - 1 && isSameUrlRelaxed(stack[index + 1], url)) {
    state.index = index + 1;
    return;
  }
  
  // Check if reloading or re-navigating to current page
  if (isSameUrlRelaxed(stack[index], url)) {
    state.stack[index] = url;
    return;
  }
  
  // New navigation: truncate forward history and push new URL
  const newStack = stack.slice(0, index + 1);
  newStack.push(url);
  if (newStack.length > 100) {
    newStack.shift();
    state.index = Math.max(0, state.index - 1);
  } else {
    state.index = newStack.length - 1;
  }
  state.stack = newStack;
}

function recordTransition(tabId, currentUrl, resolved) {
  if (!tabNavStack.has(tabId)) {
    tabNavStack.set(tabId, { stack: [resolved], index: 0 });
    return;
  }
  const state = tabNavStack.get(tabId);
  // Update the current slot with active view URL before it gets destroyed
  state.stack[state.index] = currentUrl;
  // Truncate any forward history
  state.stack = state.stack.slice(0, state.index + 1);
  // Push the resolved transition URL
  state.stack.push(resolved);
  state.index = state.stack.length - 1;
}

function softwareGoBack(winState, tabId) {
  const state = tabNavStack.get(tabId);
  if (!state || state.index <= 0) return false;
  
  const v = winState.views.get(tabId);
  if (v) {
    // Save current active URL in slot
    state.stack[state.index] = v.webContents.getURL();
    
    // Get target URL
    const prevUrl = state.stack[state.index - 1];
    
    const isCurrentlyInternal = v.webContents.getURL().startsWith('file://') || v.webContents.getURL().startsWith('kiyo://');
    const isNavigatingInternal = prevUrl.startsWith('file://') || prevUrl.startsWith('kiyo://');
    
    // Update the index
    state.index = state.index - 1;
    
    if (isCurrentlyInternal !== isNavigatingInternal) {
      winState.window.contentView.removeChildView(v);
      winState.views.delete(tabId);
      viewToWindow.delete(v.webContents.id);
      v.webContents.destroy();
      createView(winState, tabId, prevUrl);
    } else {
      v.webContents.loadURL(prevUrl).catch(e => console.error('[kiyo] soft back:', e.message));
    }
    return true;
  }
  return false;
}

function softwareGoForward(winState, tabId) {
  const state = tabNavStack.get(tabId);
  if (!state || state.index >= state.stack.length - 1) return false;
  
  const v = winState.views.get(tabId);
  if (v) {
    // Save current active URL in slot
    state.stack[state.index] = v.webContents.getURL();
    
    // Get target URL
    const nextUrl = state.stack[state.index + 1];
    
    const isCurrentlyInternal = v.webContents.getURL().startsWith('file://') || v.webContents.getURL().startsWith('kiyo://');
    const isNavigatingInternal = nextUrl.startsWith('file://') || nextUrl.startsWith('kiyo://');
    
    // Update the index
    state.index = state.index + 1;
    
    if (isCurrentlyInternal !== isNavigatingInternal) {
      winState.window.contentView.removeChildView(v);
      winState.views.delete(tabId);
      viewToWindow.delete(v.webContents.id);
      v.webContents.destroy();
      createView(winState, tabId, nextUrl);
    } else {
      v.webContents.loadURL(nextUrl).catch(e => console.error('[kiyo] soft forward:', e.message));
    }
    return true;
  }
  return false;
}

function broadcastNavState(winState, tabId) {
  if (!winState || !winState.window || winState.window.isDestroyed()) return;
  const v = winState.views.get(tabId);
  if (!v) return;
  
  const webCanBack = v.webContents.canGoBack();
  const webCanForward = v.webContents.canGoForward();
  
  const state = tabNavStack.get(tabId);
  const softCanBack = state && state.index > 0;
  const softCanForward = state && state.index < state.stack.length - 1;
  
  const canBack = webCanBack || softCanBack;
  const canForward = webCanForward || softCanForward;
  
  winState.window.webContents.send('nav-state', tabId, canBack, canForward);
}


const tabSleepTimers = new Map(); // tabId → setTimeout handle
const sleepedTabs = new Map();    // tabId → { url, title, favicon } (sleeping tabs have no view)
const thumbnailCache = new Map(); // tabId → dataURL
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
  timeFormat: '12h',
  startupUrl: 'kiyo://welcome',
  downloadsPathPrompt: false,
  customAccentColor: '#00d2ff',
  sidebarPosition: 'left',
  compactUi: false,
  uiFontFamily: 'Inter',
  startupMode: 'session',
  autoWipeHistory: false,
  autoWipeCookies: false,
  autoWipeCache: false,
  secureDns: 'default',
  tabSleepingWhitelist: '',
  batterySaver: true,
  diskCacheCap: 500,
  tabCloseFocus: 'right',
  uiSoundsEnabled: true,
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
  timeFormat: v => ['12h', '24h'].includes(v),
  startupUrl: v => typeof v === 'string',
  downloadsPathPrompt: v => typeof v === 'boolean',
  customAccentColor: v => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v),
  sidebarPosition: v => ['left', 'right'].includes(v),
  compactUi: v => typeof v === 'boolean',
  uiFontFamily: v => ['Inter', 'JetBrains Mono', 'System'].includes(v),
  startupMode: v => ['newtab', 'session', 'url'].includes(v),
  autoWipeHistory: v => typeof v === 'boolean',
  autoWipeCookies: v => typeof v === 'boolean',
  autoWipeCache: v => typeof v === 'boolean',
  secureDns: v => ['default', 'cloudflare', 'quad9', 'google'].includes(v),
  tabSleepingWhitelist: v => typeof v === 'string',
  batterySaver: v => typeof v === 'boolean',
  diskCacheCap: v => typeof v === 'number' && v >= 50 && v <= 2000,
  tabCloseFocus: v => ['right', 'last'].includes(v),
  uiSoundsEnabled: v => typeof v === 'boolean',
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
async function createWindow(isPrivate = false, restoredSession = null) {
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

  // Apply secure global wrappers to the session
  secureSession(win.webContents.session);
  try {
    win.webContents.session.setCacheSize(settings.diskCacheCap * 1024 * 1024);
  } catch {}
  bindCosmeticFilters(win.webContents);

  const winState = {
    window: win,
    views: new Map(),
    activeViewId: null,
    isPrivate,
    partitionId: isPrivate ? PrivateSessionManager.getPartitionId() : undefined
  };
  windows.set(win.webContents.id, winState);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'ui', 'index.html'));

  if (!extensionsManager) {
    extensionsManager = new ElectronChromeExtensions({
      session: session.defaultSession,
      createTab: async (details) => {
        const winState = [...windows.values()][0];
        if (!winState) return [null, null];
        const newId = newTabId();
        const resolved = resolveUrl(details.url) || PAGE.home();
        createView(winState, newId, resolved);
        winState.window.webContents.send('extension-created-tab', newId, details.url);
        const view = winState.views.get(newId);
        return [view?.webContents ?? null, winState.window];
      },
      selectTab: async (webContents, browserWindow) => {
        const winState = windows.get(browserWindow.webContents.id);
        if (!winState) return;
        for (const [tabId, view] of winState.views) {
          if (view.webContents.id === webContents.id) {
            switchView(winState, tabId);
            winState.window.webContents.send('shortcut', 'focus-tab-' + tabId);
            break;
          }
        }
      },
      removeTab: async (webContents, browserWindow) => {
        const winState = windows.get(browserWindow.webContents.id);
        if (!winState) return;
        for (const [tabId, view] of winState.views) {
          if (view.webContents.id === webContents.id) {
            closeView(winState, tabId);
            winState.window.webContents.send('tab-closed-by-extension', tabId);
            break;
          }
        }
      },
      windowsGetLastFocused: async () => {
        const focused = BrowserWindow.getFocusedWindow();
        return focused ?? [...windows.values()][0]?.window ?? null;
      },
      createWindow: async (details) => createWindow(false),
      removeWindow: async (browserWindow) => browserWindow.close(),
    });

    // Load all previously installed extensions on startup
    if (fs.existsSync(EXTENSIONS_PATH)) {
      const extDirs = fs.readdirSync(EXTENSIONS_PATH);
      for (const dir of extDirs) {
        const extPath = path.join(EXTENSIONS_PATH, dir);
        if (fs.statSync(extPath).isDirectory()) {
          try {
            await session.defaultSession.loadExtension(extPath, { allowFileAccess: true });
          } catch (e) {
            console.error('[kiyo-ext] Failed to load extension:', dir, e.message);
          }
        }
      }
    }
  }

  // Register this window with the extensions manager
  if (extensionsManager && !isPrivate) {
    extensionsManager.addTab(win.webContents, win);
  }

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
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://fonts.googleapis.com chrome-extension:; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com data:; " +
            "img-src * data: blob:; " +
            "connect-src 'self' https: wss: chrome-extension:;",
          ],
        },
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  // Permissions are globally managed in secureSession

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  win.on('close', () => {
    if (isPrivate) PrivateSessionManager.decrement();
    if (!isPrivate) {
      if (winState.lastSession) {
        writeJSON(SESSION_PATH, winState.lastSession);
      } else {
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
    }

    if (settings.autoWipeHistory) {
      history = [];
      saveHistory();
    }
    try {
      const options = { storages: [] };
      if (settings.autoWipeCookies) options.storages.push('cookies');
      if (settings.autoWipeCache) options.storages.push('caches');
      if (options.storages.length > 0) {
        win.webContents.session.clearStorageData(options);
      }
    } catch {}
    
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
    if (!settings.downloadsPathPrompt) {
      item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()));
    }
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

// --- IPC Registration ---
const registerAllIPC = require('./ipc');
const ipcContext = {
  EXTENSIONS_PATH,
  getSettings: () => settings,
  setSetting: (key, value) => {
    settings[key] = value;
    if (key === 'compactUi' || key === 'sidebarPosition') {
      for (const winState of windows.values()) updateActiveViewBounds(winState);
    }
  },
  validateSetting: (key, value) => SETTING_SCHEMA[key] && SETTING_SCHEMA[key](value),
  saveSettings,
  adblock,
  getSleepStats: () => {
    let activeCount = 0;
    for (const winState of windows.values()) {
      activeCount += winState.views.size;
    }
    return { sleeping: sleepedTabs.size, active: activeCount };
  },
  windows,
  getBookmarks: () => bookmarks,
  setBookmarks: (val) => { bookmarks = val; },
  getHistory: () => history,
  setHistory: (val) => { history = val; },
  MAX_BOOKMARKS,
  saveBookmarks,
  saveHistory,
  pwManager,
  pendingCredentials,
  broadcast,
  finishOnboarding: () => {
    writeJSON(path.join(USER_DATA, 'kiyo-onboarded.json'), { onboarded: true, date: Date.now() });
  },
  getViewByTabId: (sender, tabId) => {
    const winState = getWinState(sender);
    return winState ? winState.views.get(tabId) : null;
  }
};
registerAllIPC(ipcMain, ipcContext);
// ------------------------

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

ipcMain.on('toggle-tab-mute', (event, id) => {
  const winState = getWinState(event.sender);
  if (!winState) return;
  const v = winState.views.get(id);
  if (v && v.webContents && !v.webContents.isDestroyed()) {
    const isMuted = v.webContents.isAudioMuted();
    v.webContents.setAudioMuted(!isMuted);
  }
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

  if (resolved !== PAGE.reader()) {
    readerArticles.delete(id);
  }

  const currentUrl = v.webContents.getURL() || '';
  const isCurrentlyInternal = currentUrl === '' || currentUrl.startsWith('file://') || currentUrl.startsWith('kiyo://');
  const isNavigatingInternal = resolved.startsWith('file://') || resolved.startsWith('kiyo://');

  if (isCurrentlyInternal !== isNavigatingInternal) {
    winState.window.contentView.removeChildView(v);
    winState.views.delete(id);
    viewToWindow.delete(v.webContents.id);
    v.webContents.destroy();

    recordTransition(id, currentUrl, resolved);
    createView(winState, id, resolved);
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
  if (!winState) return;
  const tabId = winState.activeViewId;
  const v = winState.views.get(tabId);
  if (!v) return;

  if (v.webContents.canGoBack()) {
    v.webContents.goBack();
  } else {
    softwareGoBack(winState, tabId);
  }
  setTimeout(() => broadcastNavState(winState, tabId), 50);
});

ipcMain.on('go-forward', (event) => {
  const winState = getWinState(event.sender);
  if (!winState) return;
  const tabId = winState.activeViewId;
  const v = winState.views.get(tabId);
  if (!v) return;

  if (v.webContents.canGoForward()) {
    v.webContents.goForward();
  } else {
    softwareGoForward(winState, tabId);
  }
  setTimeout(() => broadcastNavState(winState, tabId), 50);
});

ipcMain.on('reader-go-back', (event) => {
  const winState = getWinState(event.sender);
  if (!winState) return;
  const tabId = getTabIdByWebContents(event.sender) || winState.activeViewId;
  const article = readerArticles.get(tabId);
  if (article && article.url) {
    const targetUrl = article.url;
    readerArticles.delete(tabId);
    
    const v = winState.views.get(tabId);
    if (v) {
      // Save current reader URL and update the stack pointer to targetUrl
      const state = tabNavStack.get(tabId);
      if (state) {
        state.stack[state.index] = v.webContents.getURL();
        if (state.index > 0 && state.stack[state.index - 1] === targetUrl) {
          state.index = state.index - 1;
        } else {
          state.stack = state.stack.slice(0, state.index);
          state.stack.push(targetUrl);
          state.index = state.stack.length - 1;
        }
      }
      
      const isCurrentlyInternal = true;
      const isNavigatingInternal = targetUrl.startsWith('file://') || targetUrl.startsWith('kiyo://');
      
      if (isCurrentlyInternal !== isNavigatingInternal) {
        winState.window.contentView.removeChildView(v);
        winState.views.delete(tabId);
        viewToWindow.delete(v.webContents.id);
        v.webContents.destroy();
        createView(winState, tabId, targetUrl);
      } else {
        v.webContents.loadURL(targetUrl).catch(e => console.error('[kiyo] reader back:', e.message));
      }
    }
  }
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
    winState.lastSession = sessionData;
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
  if (readerArticles.has(tabId)) {
    return readerArticles.get(tabId);
  }
  for (const winState of windows.values()) {
    const view = winState.views.get(tabId);
    if (view) {
      const url = view.webContents.getURL();
      try {
        const html = await view.webContents.executeJavaScript('document.documentElement.outerHTML');
        const article = await extractArticle(html, url);
        const result = { ...article, url };
        readerArticles.set(tabId, result);
        return result;
      } catch (e) {
        console.error('[kiyo] extract-article error:', e.message);
        return null;
      }
    }
  }
  return null;
});

ipcMain.handle('get-reader-article', (event) => {
  const tabId = getTabIdByWebContents(event.sender);
  if (!tabId) return null;
  return readerArticles.get(tabId) || null;
});

ipcMain.handle('check-reader-mode', async (_, tabId) => {
  if (readerArticles.has(tabId)) {
    return readerArticles.get(tabId).isArticle;
  }
  for (const winState of windows.values()) {
    const view = winState.views.get(tabId);
    if (view) {
      try {
        const html = await view.webContents.executeJavaScript('document.documentElement.outerHTML');
        const url = view.webContents.getURL();
        const article = await extractArticle(html, url);
        readerArticles.set(tabId, { ...article, url });
        return article.isArticle;
      } catch (e) {
        return false;
      }
    }
  }
  return false;
});

ipcMain.handle('get-tab-preview', async (_, tabId) => {
  if (thumbnailCache.has(tabId)) {
    return thumbnailCache.get(tabId);
  }
  for (const winState of windows.values()) {
    const view = winState.views.get(tabId);
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      try {
        const image = await view.webContents.capturePage({ width: 320, height: 180 });
        if (image) {
          const url = image.toDataURL();
          thumbnailCache.set(tabId, url);
          return url;
        }
      } catch (e) {
        return null;
      }
    }
  }
  return null;
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

function getTabIdByWebContents(wc) {
  if (!wc) return null;
  for (const winState of windows.values()) {
    for (const [tabId, view] of winState.views.entries()) {
      if (view.webContents.id === wc.id) {
        return tabId;
      }
    }
  }
  return null;
}

function createView(winState, id, url, lazy = false) {
  const isInternal = url.startsWith('file://') || url.startsWith('kiyo://');
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: !isInternal, // untrusted web content is fully sandboxed
      preload: isInternal
        ? path.join(__dirname, '..', 'preload', 'preload.js')
        : path.join(__dirname, '..', 'preload', 'content-preload.js'),
      partition: winState.partitionId,
      spellcheck: true,
      enableWebSQL: isInternal,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
    },
  });

  winState.views.set(id, view);
  viewToWindow.set(view.webContents.id, winState);
  pushToNavStack(id, url);

  if (winState.activeViewId === id && !lazy) {
    winState.window.contentView.addChildView(view);
    updateActiveViewBounds(winState);
  }

  // ── Browser View Security Hardening ──────────────────────────────────────
  // Intercept window.open calls to deny native popups and launch as regular tabs
  view.webContents.setWindowOpenHandler((details) => {
    const wState = viewToWindow.get(view.webContents.id);
    if (wState && wState.window && !wState.window.isDestroyed()) {
      const newId = newTabId();
      wState.window.webContents.send('extension-created-tab', newId, details.url);
    }
    return { action: 'deny' }; // Deny original OS window generation
  });

  // Block untrusted web pages from navigating to privileged local file/internal URIs
  view.webContents.on('will-navigate', (event, navigationUrl) => {
    const isTargetInternal = navigationUrl.startsWith('file://') || navigationUrl.startsWith('kiyo://');
    if (isTargetInternal && !isInternal) {
      event.preventDefault();
      console.warn(`[security] Blocked navigation from untrusted site to internal resource: ${navigationUrl}`);
    }
  });

  view.webContents.on('will-redirect', (event, navigationUrl) => {
    const isTargetInternal = navigationUrl.startsWith('file://') || navigationUrl.startsWith('kiyo://');
    if (isTargetInternal && !isInternal) {
      event.preventDefault();
      console.warn(`[security] Blocked redirect from untrusted site to internal resource: ${navigationUrl}`);
    }
  });

  // Notify extension manager of new tab (required for chrome.tabs API)
  if (extensionsManager && !winState.isPrivate) {
    extensionsManager.addTab(view.webContents, winState.window);
  }
  
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
    pushToNavStack(id, u);
    broadcastNavState(winState, id);
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
    if (isMainFrame) {
      pushToNavStack(id, u);
      broadcastNavState(winState, id);
    }
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

  const view = winState.views.get(id);
  if (view && settings.tabSleepingWhitelist) {
    const u = view.webContents?.getURL() || '';
    try {
      const hostname = new URL(u).hostname;
      const list = settings.tabSleepingWhitelist.split(',').map(s => s.trim().toLowerCase());
      if (list.some(domain => domain && hostname.includes(domain))) return;
    } catch {}
  }

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
  createView(winState, id, data.url, true); // Create view in lazy (pending) state
  winState.window.webContents.send('tab-woke', id, data.url);
}

function switchView(winState, id) {
  if (sleepedTabs.has(id)) {
    wakeTab(winState, id);
    // Do not return; continue below to activate and load the awakened view linearly
  }

  const prevId = winState.activeViewId;

  if (prevId && winState.views.has(prevId)) {
    const prevView = winState.views.get(prevId);
    if (prevView && prevView.webContents && !prevView.webContents.isDestroyed()) {
      prevView.webContents.capturePage({ width: 320, height: 180 }).then(img => {
        if (img) thumbnailCache.set(prevId, img.toDataURL());
      }).catch(() => {});
      if (winState.window && !winState.window.isDestroyed()) {
        winState.window.contentView.removeChildView(prevView);
      }
    }
  }
  winState.activeViewId = id;
  const v = winState.views.get(id);

  if (extensionsManager && v) {
    extensionsManager.selectTab(v.webContents);
  }

  if (v) {
    if (v.pendingUrl) {
      v.webContents.loadURL(v.pendingUrl).catch(e => console.error('[kiyo] view load:', e.message));
      v.pendingUrl = null;
    }
    winState.window.contentView.addChildView(v);
    updateActiveViewBounds(winState);
    winState.window.webContents.send('url-changed', id, getUIUrl(v.webContents.getURL() || v.pendingUrl || ''));
    broadcastNavState(winState, id);
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
  readerArticles.delete(id);
  thumbnailCache.delete(id);
  tabNavStack.delete(id);
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
  if (extensionsManager) {
    extensionsManager.removeTab(v.webContents);
  }
  v.webContents.destroy();
  winState.views.delete(id);
}

function updateActiveViewBounds(winState) {
  if (!winState.window || !winState.activeViewId) return;
  const v = winState.views.get(winState.activeViewId);
  if (!v) return;
  const { width, height } = winState.window.getContentBounds();
  const headerH = settings.compactUi ? 44 : Math.round(settings.geometry.headerHeight);
  const sbW = settings.compactUi ? 60 : Math.round(settings.geometry.sidebarWidth);
  const isRight = settings.sidebarPosition === 'right';
  v.setBounds({
    x: isRight ? 0 : sbW,
    y: headerH,
    width: Math.max(1, Math.round(width - sbW)),
    height: Math.max(1, Math.round(height - headerH)),
  });
}

function setupSecureDNS(sess) {
  try {
    if (!settings.secureDns || settings.secureDns === 'default') return;
    const endpoints = {
      cloudflare: 'https://cloudflare-dns.com/dns-query',
      quad9: 'https://dns.quad9.net/dns-query',
      google: 'https://dns.google/dns-query',
    };
    if (endpoints[settings.secureDns] && typeof sess.setServerResolverMode === 'function') {
      sess.setServerResolverMode('secure_only', [endpoints[settings.secureDns]]);
    }
  } catch (e) { console.warn('[kiyo] DoH setup failed', e); }
}

function setupAdblock(sess) {
  // YouTube CDN hostnames that must never be blocked — video streams, thumbnails, avatars
  const YOUTUBE_ALLOWLIST = new Set([
    'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
    'googlevideo.com', 'ytimg.com', 'yt3.ggpht.com', 'ggpht.com',
    'youtube-nocookie.com', 'ytimg-edge.com',
  ]);
  function isYouTubeCDN(hostname) {
    if (YOUTUBE_ALLOWLIST.has(hostname)) return true;
    // Match subdomains like r3---sn-xxx.googlevideo.com
    for (const allowed of YOUTUBE_ALLOWLIST) {
      if (hostname.endsWith('.' + allowed)) return true;
    }
    return false;
  }

  sess.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const url = details.url;
    if (url.startsWith('kiyo://') || url.startsWith('file://')) {
      return callback({ cancel: false });
    }

    // Never block media streams (video/audio) — EasyList rules can
    // accidentally match YouTube's internal video stream URLs
    if (details.resourceType === 'media') {
      return callback({ cancel: false });
    }

    // Exempt all YouTube CDN requests — player scripts, thumbnails, streams
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (isYouTubeCDN(hostname)) {
        return callback({ cancel: false });
      }
    } catch (e) {}

    if (settings.blockHyperlinkAuditing && details.resourceType === 'ping') {
      adblock.incrementStats();
      return callback({ cancel: true });
    }

    if (settings.adblockEnabled) {
      try {
        const { evaluatePrivacyShield } = require('./lib/privacy');
        const shieldRes = evaluatePrivacyShield(url, details);
        if (shieldRes.redirectURL) return callback({ redirectURL: shieldRes.redirectURL });
        if (shieldRes.cancel) {
          adblock.incrementStats();
          return callback({ cancel: true });
        }
      } catch (e) {}

      if (adblock.shouldBlock(url, details.resourceType)) {
        adblock.incrementStats();
        return callback({ cancel: true });
      }
    }

    callback({ cancel: false });
  });
}

// ─── Global Secure Session Wrapper ────────────────────────────────────────────
const ALLOWED_PERMISSIONS = new Set([
  'media', 'geolocation', 'notifications', 'fullscreen',
  'pointerLock', 'openExternal', 'clipboard-read', 'clipboard-sanitized-write',
  'idle-detection', 'payment', 'midi',
]);

function secureSession(ses) {
  if (!ses) return;

  try {
    ses.setSpellCheckerEnabled(true);
    ses.setSpellCheckerLanguages(['en-US']);
  } catch {}

  setupAdblock(ses);
  setupSecureDNS(ses);

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => {
    return ALLOWED_PERMISSIONS.has(permission);
  });
}



// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  loadSettings();
  loadBookmarks();
  loadHistory();
  
  // Auto-lock password manager on system idle (5 minutes = 300 seconds)
  setInterval(() => {
    if (pwManager.isUnlocked() && powerMonitor.getSystemIdleTime() >= 300) {
      pwManager.lock();
    }
  }, 30000); // Check every 30 seconds

  adblock.initAdblock();

  const defaultUA = session.defaultSession.getUserAgent();
  const cleanUA = defaultUA.replace(/kiyo\/[0-9\.-]+\s?/, '').replace(/Electron\/[0-9\.-]+\s?/, '');
  app.userAgentFallback = cleanUA;

  createWindow();

  // Apply secure global wrappers to the default session
  secureSession(session.defaultSession);

  // Global audio status monitor for all active tabs
  setInterval(() => {
    for (const winState of windows.values()) {
      if (!winState.window || winState.window.isDestroyed()) continue;
      for (const [id, view] of winState.views) {
        if (!view || !view.webContents || view.webContents.isDestroyed()) continue;
        try {
          const audible = view.webContents.isCurrentlyAudible();
          if (view._lastAudible !== audible) {
            view._lastAudible = audible;
            winState.window.webContents.send('tab-audio-state', id, audible);
          }
        } catch {}
      }
    }
  }, 500);

  // Spellchecker and secure sessions are managed globally in secureSession
  app.on('session-created', (ses) => {
    secureSession(ses);
  });

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
      if (input.type === 'keyDown') {
        const key = input.key;
        
        // Handle Alt + Left/Right arrow navigation
        if (input.alt) {
          const winState = getWinState(wc);
          if (winState) {
            const tabId = winState.activeViewId;
            const v = winState.views.get(tabId);
            if (v) {
              if (key === 'ArrowLeft') {
                event.preventDefault();
                if (v.webContents.canGoBack()) {
                  v.webContents.goBack();
                } else {
                  softwareGoBack(winState, tabId);
                }
                setTimeout(() => broadcastNavState(winState, tabId), 50);
                return;
              } else if (key === 'ArrowRight') {
                event.preventDefault();
                if (v.webContents.canGoForward()) {
                  v.webContents.goForward();
                } else {
                  softwareGoForward(winState, tabId);
                }
                setTimeout(() => broadcastNavState(winState, tabId), 50);
                return;
              }
            }
          }
        }
        
        if (input.control || input.meta) {
          const keyLower = key.toLowerCase();
          const winState = getWinState(wc);
          const win = winState ? winState.window : BrowserWindow.getFocusedWindow();
          if (win && shortcuts[keyLower]) {
            shortcuts[keyLower](win, input);
            event.preventDefault();
          }
        }
      }
    });
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
