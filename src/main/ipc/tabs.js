'use strict';
/**
 * ipc/tabs.js — Tab lifecycle IPC handlers
 * Handles: create-tab, switch-tab, close-tab, duplicate-tab,
 *           wake-tab, sleep-tab-now, sleep-all-tabs,
 *           toggle-tab-mute, show-tab-menu, get-tab-preview, get-sleep-stats
 */

const { ipcMain, Menu, MenuItem } = require('electron');

module.exports = function registerTabsIPC(ctx) {
  const {
    windows, getWinState, createView, switchView, closeView,
    sleepTab, wakeTab, sleepedTabs, thumbnailCache,
    resolveUrl, PAGE, newTabId, MAX_TABS, broadcast, safeSend,
  } = ctx;

  ipcMain.on('create-tab', (event, id, url, lazy) => {
    const win = getWinState(event.sender);
    if (!win) return;
    if (win.views.size >= MAX_TABS) {
      safeSend(event.sender, 'tab-limit-reached');
      return;
    }
    createView(win, id, url, lazy);
  });

  ipcMain.on('switch-tab', (event, id) => {
    const win = getWinState(event.sender);
    if (!win) return;
    switchView(win, id);
  });

  ipcMain.on('close-tab', (event, id) => {
    const win = getWinState(event.sender);
    if (!win) return;
    closeView(win, id);
  });

  ipcMain.on('duplicate-tab', (event, id) => {
    const win = getWinState(event.sender);
    if (!win) return;
    const view = win.views.get(id);
    if (!view || view.webContents.isDestroyed()) return;
    const url = view.webContents.getURL() || PAGE.home();
    const newId = newTabId();
    createView(win, newId, url, false);
    safeSend(event.sender, 'tab-duplicated', newId, url);
  });

  ipcMain.on('wake-tab', (event, id) => {
    const win = getWinState(event.sender);
    if (!win) return;
    wakeTab(win, id);
  });

  ipcMain.on('sleep-tab-now', (event, id) => {
    const win = getWinState(event.sender);
    if (!win) return;
    if (win.activeViewId === id) return; // never sleep the active tab
    sleepTab(win, id);
  });

  ipcMain.on('sleep-all-tabs', (event) => {
    const win = getWinState(event.sender);
    if (!win) return;
    for (const id of win.views.keys()) {
      if (id !== win.activeViewId) sleepTab(win, id);
    }
  });

  ipcMain.on('toggle-tab-mute', (event, id) => {
    const win = getWinState(event.sender);
    if (!win) return;
    const view = win.views.get(id);
    if (!view || view.webContents.isDestroyed()) return;
    const muted = view.webContents.isAudioMuted();
    view.webContents.setAudioMuted(!muted);
  });

  ipcMain.on('show-tab-menu', (event, tabId, currentGroupId, groupsList) => {
    const win = getWinState(event.sender);
    if (!win) return;
    const isSleeping = sleepedTabs.has(tabId);
    const menu = new Menu();

    menu.append(new MenuItem({ label: 'Duplicate', click: () => event.sender.send('tab-menu-action', tabId, 'duplicate') }));
    menu.append(new MenuItem({ type: 'separator' }));

    if (isSleeping) {
      menu.append(new MenuItem({ label: 'Wake Tab', click: () => event.sender.send('tab-menu-action', tabId, 'wake') }));
    } else {
      menu.append(new MenuItem({ label: 'Sleep Tab', click: () => event.sender.send('tab-menu-action', tabId, 'sleep') }));
    }

    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'New Group', click: () => event.sender.send('tab-menu-action', tabId, 'new-group') }));

    if (groupsList && groupsList.length > 0) {
      const addSub = new Menu();
      for (const g of groupsList) {
        addSub.append(new MenuItem({ label: g.name, click: () => event.sender.send('tab-menu-action', tabId, 'add-to-group', g.id) }));
      }
      menu.append(new MenuItem({ label: 'Add to Group', submenu: addSub }));
    }

    if (currentGroupId) {
      menu.append(new MenuItem({ label: 'Remove from Group', click: () => event.sender.send('tab-menu-action', tabId, 'remove-from-group') }));
    }

    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Close Tab', click: () => event.sender.send('tab-menu-action', tabId, 'close') }));

    menu.popup({ window: win.window });
  });

  ipcMain.handle('get-tab-preview', async (event, tabId) => {
    return thumbnailCache.get(tabId) || null;
  });

  ipcMain.handle('get-sleep-stats', async (event) => {
    const win = getWinState(event.sender);
    if (!win) return { sleeping: 0, active: 0 };
    const sleeping = [...win.views.keys()].filter(id => sleepedTabs.has(id)).length;
    const active = win.views.size - sleeping;
    return { sleeping, active };
  });
};
