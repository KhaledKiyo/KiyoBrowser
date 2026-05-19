'use strict';
/**
 * ipc/navigation.js — Navigation, find, zoom IPC handlers
 * Handles: navigate, go-back, go-forward, reload, reader-go-back,
 *           find-in-page, stop-find-in-page, set-zoom, get-zoom
 */

const { ipcMain } = require('electron');

module.exports = function registerNavigationIPC(ctx) {
  const {
    getWinState, resolveUrl, PAGE, readerArticles,
    tabNavStack, softwareGoBack, softwareGoForward,
    pushToNavStack, createView, closeView, switchView,
    broadcast, safeSend, getTabIdByWebContents,
  } = ctx;

  ipcMain.on('navigate', (event, url) => {
    const win = getWinState(event.sender);
    if (!win || !win.activeViewId) return;
    const id = win.activeViewId;
    const view = win.views.get(id);
    if (!view || view.webContents.isDestroyed()) return;
    const resolved = resolveUrl(url);
    if (!resolved) return;
    view.webContents.loadURL(resolved);
  });

  ipcMain.on('go-back', (event) => {
    const win = getWinState(event.sender);
    if (!win || !win.activeViewId) return;
    const id = win.activeViewId;
    const view = win.views.get(id);
    if (!view || view.webContents.isDestroyed()) return;
    if (view.webContents.canGoBack()) {
      view.webContents.goBack();
    } else {
      softwareGoBack(win, id);
    }
  });

  ipcMain.on('go-forward', (event) => {
    const win = getWinState(event.sender);
    if (!win || !win.activeViewId) return;
    const id = win.activeViewId;
    const view = win.views.get(id);
    if (!view || view.webContents.isDestroyed()) return;
    if (view.webContents.canGoForward()) {
      view.webContents.goForward();
    } else {
      softwareGoForward(win, id);
    }
  });

  ipcMain.on('reload', (event) => {
    const win = getWinState(event.sender);
    if (!win || !win.activeViewId) return;
    const view = win.views.get(win.activeViewId);
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.reload();
  });

  ipcMain.on('reader-go-back', (event) => {
    const win = getWinState(event.sender);
    if (!win || !win.activeViewId) return;
    const id = win.activeViewId;
    const article = readerArticles.get(id);
    const sourceUrl = article?.url;
    readerArticles.delete(id);
    const view = win.views.get(id);
    if (!view || view.webContents.isDestroyed()) return;
    if (sourceUrl) {
      view.webContents.loadURL(sourceUrl);
    } else if (view.webContents.canGoBack()) {
      view.webContents.goBack();
    } else {
      softwareGoBack(win, id);
    }
  });

  ipcMain.on('find-in-page', (event, text, options) => {
    const win = getWinState(event.sender);
    if (!win || !win.activeViewId) return;
    const view = win.views.get(win.activeViewId);
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.findInPage(text, options || {});
  });

  ipcMain.on('stop-find-in-page', (event, action) => {
    const win = getWinState(event.sender);
    if (!win || !win.activeViewId) return;
    const view = win.views.get(win.activeViewId);
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.stopFindInPage(action || 'clearSelection');
  });

  ipcMain.on('set-zoom', (event, level) => {
    const win = getWinState(event.sender);
    if (!win || !win.activeViewId) return;
    const view = win.views.get(win.activeViewId);
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.setZoomLevel(level);
  });

  ipcMain.handle('get-zoom', async (event) => {
    const win = getWinState(event.sender);
    if (!win || !win.activeViewId) return 0;
    const view = win.views.get(win.activeViewId);
    if (!view || view.webContents.isDestroyed()) return 0;
    return view.webContents.getZoomLevel();
  });
};
