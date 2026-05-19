'use strict';
/**
 * ipc/downloads.js — Download list IPC handlers
 * Handles: get-downloads, clear-downloads
 */

const { ipcMain } = require('electron');

module.exports = function registerDownloadsIPC(ctx) {
  const { downloads, broadcast } = ctx;

  ipcMain.handle('get-downloads', async () => {
    return downloads;
  });

  ipcMain.on('clear-downloads', (event) => {
    downloads.length = 0;
    broadcast('downloads-cleared');
  });
};
