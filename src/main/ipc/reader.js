'use strict';
/**
 * ipc/reader.js — Reader mode and tab preview IPC handlers
 * Handles: extract-article, get-reader-article, check-reader-mode, get-tab-preview
 */

const { ipcMain } = require('electron');

module.exports = function registerReaderIPC(ctx) {
  const { getWinState, readerArticles, thumbnailCache, extractArticle, isArticlePage } = ctx;

  ipcMain.handle('extract-article', async (event, tabId) => {
    const win = getWinState(event.sender);
    if (!win) return null;
    const view = win.views.get(tabId);
    if (!view || view.webContents.isDestroyed()) return null;
    try {
      const html = await view.webContents.executeJavaScript('document.documentElement.outerHTML');
      const url = view.webContents.getURL();
      const article = extractArticle(html, url);
      if (article) {
        readerArticles.set(tabId, article);
        return article;
      }
      return null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('check-reader-mode', async (event, tabId) => {
    const win = getWinState(event.sender);
    if (!win) return false;
    const view = win.views.get(tabId);
    if (!view || view.webContents.isDestroyed()) return false;
    const url = view.webContents.getURL();
    if (!url || url.startsWith('file://') || url.startsWith('kiyo://')) return false;
    try {
      const html = await view.webContents.executeJavaScript(
        '(function(){try{return document.body?.innerHTML?.substring(0,8000)||"";}catch(e){return ""}})()'
      );
      return isArticlePage(html);
    } catch {
      return false;
    }
  });

  ipcMain.handle('get-reader-article', async (event) => {
    const win = getWinState(event.sender);
    if (!win || !win.activeViewId) return null;
    return readerArticles.get(win.activeViewId) || null;
  });
};
