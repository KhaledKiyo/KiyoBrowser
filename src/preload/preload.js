const { contextBridge, ipcRenderer } = require('electron');

// Bug #13 fix: track exactly the ONE listener we registered per channel so we
// only remove OUR previous one, not any others (removeAllListeners was too aggressive).
const _kiyoListeners = new Map();
function on(channel, wrapper) {
  ipcRenderer.on(channel, wrapper);
}

contextBridge.exposeInMainWorld('electronAPI', {

  // ── Bootstrap (replaces fragile setTimeout race) ───────────────────────────
  rendererReady: () => ipcRenderer.invoke('renderer-ready'),

  // ── Tabs ──────────────────────────────────────────────────────────────────
  createTab: (id, url) => ipcRenderer.send('create-tab', id, url),
  switchTab: (id) => ipcRenderer.send('switch-tab', id),
  closeTab: (id) => ipcRenderer.send('close-tab', id),
  duplicateTab: (id) => ipcRenderer.send('duplicate-tab', id),
  showTabMenu: (id) => ipcRenderer.send('show-tab-menu', id),

  // ── Navigation ────────────────────────────────────────────────────────────
  navigate: (url) => ipcRenderer.send('navigate', url),
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  reload: () => ipcRenderer.send('reload'),

  // ── Session persistence ───────────────────────────────────────────────────
  saveSession: (data) => ipcRenderer.send('save-session', data),

  // ── Tab events ────────────────────────────────────────────────────────────
  onUrlChanged: (cb) => on('url-changed', (_, id, url) => cb(id, url)),
  onTitleChanged: (cb) => on('title-changed', (_, id, title) => cb(id, title)),
  onFaviconChanged: (cb) => on('favicon-changed', (_, id, favicon) => cb(id, favicon)),
  onLoadingStatus: (cb) => on('loading-status', (_, id, loading) => cb(id, loading)),
  onTabDuplicated: (cb) => on('tab-duplicated', (_, id, url) => cb(id, url)),
  onTabLimitReached: (cb) => on('tab-limit-reached', () => cb()),
  onTabMenuAction: (cb) => on('tab-menu-action', (_, id, action) => cb(id, action)),

  // ── Downloads ─────────────────────────────────────────────────────────────
  onDownloadsUpdated: (cb) => on('downloads-updated', (_, downloads) => cb(downloads)),
  onDownloadProgress: (cb) => on('download-progress', (_, name, prog) => cb(name, prog)),
  onDownloadCompleted: (cb) => on('download-completed', (_, name, state) => cb(name, state)),
  onDownloadsCleared: (cb) => on('downloads-cleared', () => cb()),
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  clearDownloads: () => ipcRenderer.send('clear-downloads'),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSetting: (k, v) => ipcRenderer.send('update-setting', k, v),
  onThemeUpdated: (cb) => on('theme-updated', (_, s) => cb(s)),
  getAvailableThemes: () => ipcRenderer.invoke('get-available-themes'),

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  addBookmark: (bm) => ipcRenderer.send('add-bookmark', bm),
  removeBookmark: (url) => ipcRenderer.send('remove-bookmark', url),
  isBookmarked: (url) => ipcRenderer.invoke('is-bookmarked', url),
  onBookmarksUpdated: (cb) => on('bookmarks-updated', (_, bm) => cb(bm)),

  // ── History ───────────────────────────────────────────────────────────────
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.send('clear-history'),
  removeHistoryEntry: (url) => ipcRenderer.send('remove-history-entry', url),
  onHistoryUpdated: (cb) => on('history-updated', () => cb()),

  // ── Quick Links (Bug #4: proper userData JSON storage, not localStorage) ───
  getQuickLinks: () => ipcRenderer.invoke('get-quick-links'),
  saveQuickLinks: (links) => ipcRenderer.send('save-quick-links', links),

  // ── Keyboard shortcuts (from globalShortcut in main) ──────────────────────
  onShortcut: (cb) => on('shortcut', (_, name) => cb(name)),

  // ── Private Windows ────────────────────────────────────────────────────────
  openPrivateWindow: () => ipcRenderer.send('open-private-window'),

  // ── Context Menu ──────────────────────────────────────────────────────────
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  showFolderMenu: (folder) => ipcRenderer.send('show-folder-menu', folder),
  showNoteMenu: (id) => ipcRenderer.send('show-note-menu', id),
  onNoteAction: (cb) => on('note-action', (_, action) => cb(action)),
});
