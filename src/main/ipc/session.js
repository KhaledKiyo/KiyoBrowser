'use strict';
/**
 * ipc/session.js — Session and quick-link persistence IPC handlers
 * Handles: save-session, get-quick-links, save-quick-links
 */

const { ipcMain } = require('electron');

module.exports = function registerSessionIPC(ctx) {
  const { getWinState, writeJSON, readJSON, QUICKLINKS_PATH, SESSION_PATH } = ctx;

  ipcMain.on('save-session', (event, sessionData) => {
    const win = getWinState(event.sender);
    if (!win || win.isPrivate) return; // never persist private window sessions
    writeJSON(SESSION_PATH, sessionData);
  });

  ipcMain.handle('get-quick-links', async () => {
    return readJSON(QUICKLINKS_PATH) || [];
  });

  ipcMain.on('save-quick-links', (event, links) => {
    writeJSON(QUICKLINKS_PATH, links);
  });
};
