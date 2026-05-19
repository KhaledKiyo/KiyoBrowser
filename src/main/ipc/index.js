// ── Legacy modules (receive ipcMain + ctx) ─────────────────────────────────
const registerSettingsIPC    = require('./settings');
const registerBookmarksIPC   = require('./bookmarks');
const registerHistoryIPC     = require('./history');
const registerPasswordsIPC   = require('./passwords');
const registerExtensionsIPC  = require('./extensions');

// ── New modules (receive ctx only, call ipcMain internally) ────────────────
const registerTabsIPC        = require('./tabs');
const registerNavigationIPC  = require('./navigation');
const registerDownloadsIPC   = require('./downloads');
const registerReaderIPC      = require('./reader');
const registerSessionIPC     = require('./session');

module.exports = function registerAllIPC(ipcMain, ctx) {
  // Legacy
  registerSettingsIPC(ipcMain, ctx);
  registerBookmarksIPC(ipcMain, ctx);
  registerHistoryIPC(ipcMain, ctx);
  registerPasswordsIPC(ipcMain, ctx);
  registerExtensionsIPC(ipcMain, ctx);

  // New
  registerTabsIPC(ctx);
  registerNavigationIPC(ctx);
  registerDownloadsIPC(ctx);
  registerReaderIPC(ctx);
  registerSessionIPC(ctx);
};
