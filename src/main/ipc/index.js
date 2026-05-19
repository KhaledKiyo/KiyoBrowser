const registerSettingsIPC = require('./settings');
const registerBookmarksIPC = require('./bookmarks');
const registerHistoryIPC = require('./history');
const registerPasswordsIPC = require('./passwords');

module.exports = function registerAllIPC(ipcMain, ctx) {
  registerSettingsIPC(ipcMain, ctx);
  registerBookmarksIPC(ipcMain, ctx);
  registerHistoryIPC(ipcMain, ctx);
  registerPasswordsIPC(ipcMain, ctx);
};
