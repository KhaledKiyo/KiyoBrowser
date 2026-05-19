const fs = require('fs');
const path = require('path');

module.exports = function registerSettingsIPC(ipcMain, ctx) {
  ipcMain.handle('get-settings', () => ctx.getSettings());

  ipcMain.handle('get-adblock-stats', () => ctx.adblock.getStats());

  ipcMain.on('toggle-adblock', (_, enabled) => {
    ctx.setSetting('adblockEnabled', enabled);
    ctx.saveSettings();
    ctx.adblock.toggle(enabled);
  });

  ipcMain.on('reset-adblock-stats', () => ctx.adblock.resetStats());

  ipcMain.on('update-setting', async (event, key, value) => {
    if (ctx.validateSetting(key, value)) {
      ctx.setSetting(key, value);
      ctx.saveSettings();
      ctx.broadcast('theme-updated', ctx.getSettings());
    }
  });

  ipcMain.on('finish-onboarding', () => {
    ctx.finishOnboarding();
  });

  ipcMain.handle('get-available-themes', () => {
    try {
      const themesDir = path.join(__dirname, '..', '..', 'renderer', 'themes');
      if (!fs.existsSync(themesDir)) return [];
      const files = fs.readdirSync(themesDir);
      return files
        .filter(f => f.endsWith('.css'))
        .map(f => {
          const id = f.replace('.css', '');
          const name = id.charAt(0).toUpperCase() + id.slice(1);
          return { id, name };
        });
    } catch (e) {
      console.warn('[kiyo] failed to list themes', e);
      return [];
    }
  });

  ipcMain.handle('get-sleep-stats', () => {
    return ctx.getSleepStats();
  });

  ipcMain.handle('get-browser-stats', () => {
    let tabs = 0;
    for (const ws of ctx.windows.values()) tabs += ws.views.size;
    return {
      tabs,
      bookmarks: ctx.getBookmarks().length,
      history: ctx.getHistory().length
    };
  });

  ipcMain.handle('get-groups', () => {
    try {
      const sessionPath = path.join(require('electron').app.getPath('userData'), 'kiyo-session.json');
      const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      return data.groups || [];
    } catch(e) {
      return [];
    }
  });

  ipcMain.on('update-group', (event, id, name, color) => {
    ctx.broadcast('group-updated', id, name, color);
  });

  ipcMain.on('delete-group', (event, id) => {
    ctx.broadcast('group-deleted', id);
  });
};
