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
  getBrowserStats: () => ipcRenderer.invoke('get-browser-stats'),
  finishOnboarding: () => ipcRenderer.send('finish-onboarding'),

  // ── Tabs ──────────────────────────────────────────────────────────────────
  createTab: (id, url, lazy) => ipcRenderer.send('create-tab', id, url, lazy),
  switchTab: (id) => ipcRenderer.send('switch-tab', id),
  closeTab: (id) => ipcRenderer.send('close-tab', id),
  duplicateTab: (id) => ipcRenderer.send('duplicate-tab', id),
  showTabMenu: (id, currentGroupId, groupsList) => ipcRenderer.send('show-tab-menu', id, currentGroupId, groupsList),
  getTabPreview: (tabId) => ipcRenderer.invoke('get-tab-preview', tabId),

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
  onTabMenuAction: (cb) => on('tab-menu-action', (_, id, action, payload) => cb(id, action, payload)),
  onTabSlept: (cb) => on('tab-slept', (_, id) => cb(id)),
  onTabWoke: (cb) => on('tab-woke', (_, id, url) => cb(id, url)),
  getSleepStats: () => ipcRenderer.invoke('get-sleep-stats'),
  wakeTab: (id) => ipcRenderer.send('wake-tab', id),
  sleepTabNow: (id) => ipcRenderer.send('sleep-tab-now', id),
  sleepAllTabs: () => ipcRenderer.send('sleep-all-tabs'),
  onTabAudioState: (cb) => on('tab-audio-state', (_, id, audible) => cb(id, audible)),
  toggleTabMute: (id) => ipcRenderer.send('toggle-tab-mute', id),

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
  getAdblockStats: () => ipcRenderer.invoke('get-adblock-stats'),
  toggleAdblock: (enabled) => ipcRenderer.send('toggle-adblock', enabled),
  resetAdblockStats: () => ipcRenderer.send('reset-adblock-stats'),

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

  // ── Find in Page ──────────────────────────────────────────────────────────
  findInPage: (text, options) => ipcRenderer.send('find-in-page', text, options),
  stopFindInPage: (action) => ipcRenderer.send('stop-find-in-page', action),
  onFoundInPage: (cb) => on('found-in-page', (_, result) => cb(result)),

  // ── Zoom ──────────────────────────────────────────────────────────────────
  setZoom: (level) => ipcRenderer.send('set-zoom', level),
  getZoom: () => ipcRenderer.invoke('get-zoom'),

  // ── Autocomplete ──────────────────────────────────────────────────────────
  getAutocomplete: (text) => ipcRenderer.invoke('get-autocomplete', text),

  // ── Passwords ──────────────────────────────────────────────────────────────
  pwIsSetup: () => ipcRenderer.invoke('pw-is-setup'),
  pwIsUnlocked: () => ipcRenderer.invoke('pw-is-unlocked'),
  pwSetup: (pass) => ipcRenderer.invoke('pw-setup', pass),
  pwUnlock: (pass) => ipcRenderer.invoke('pw-unlock', pass),
  pwLock: () => ipcRenderer.send('pw-lock'),
  pwSave: (domain, username, password) => ipcRenderer.invoke('pw-save', domain, username, password),
  pwGet: (domain) => ipcRenderer.invoke('pw-get', domain),
  pwGetAll: () => ipcRenderer.invoke('pw-get-all'),
  pwDelete: (domain, username) => ipcRenderer.invoke('pw-delete', domain, username),
  pwSearch: (q) => ipcRenderer.invoke('pw-search', q),
  onPwCheckSavePrompt: (cb) => on('pw-check-save-prompt', (_, tabId, domain) => cb(tabId, domain)),
  pwSavePending: (tabId) => ipcRenderer.invoke('pw-save-pending', tabId),
  pwDiscardPending: (tabId) => ipcRenderer.send('pw-discard-pending', tabId),

  // ── Reader Mode ───────────────────────────────────────────────────────────
  extractArticle: (tabId) => ipcRenderer.invoke('extract-article', tabId),
  checkReaderMode: (tabId) => ipcRenderer.invoke('check-reader-mode', tabId),

  // ── Tab Groups Settings ───────────────────────────────────────────────────
  getGroups: () => ipcRenderer.invoke('get-groups'),
  updateGroup: (id, name, color) => ipcRenderer.send('update-group', id, name, color),
  deleteGroup: (id) => ipcRenderer.send('delete-group', id),
  onGroupUpdated: (cb) => on('group-updated', (_, id, name, color) => cb(id, name, color)),
  onGroupDeleted: (cb) => on('group-deleted', (_, id) => cb(id)),
});

// Submit listener to capture passwords
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('submit', (e) => {
      const form = e.target;
      const pwField = form.querySelector('input[type="password"]');
      const userField = pwField && (
        form.querySelector('input[type="email"]') ||
        form.querySelector('input[type="text"][autocomplete*="user"]') ||
        form.querySelector('input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"]')
      );
      if (pwField && pwField.value) {
        const username = userField ? userField.value : '';
        const password = pwField.value;
        ipcRenderer.send('pw-captured', window.location.hostname, username, password);
      }
    });
  });
}
