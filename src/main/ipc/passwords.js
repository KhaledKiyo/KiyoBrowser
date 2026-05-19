module.exports = function registerPasswordsIPC(ipcMain, ctx) {
  ipcMain.handle('pw-is-setup', () => ctx.pwManager.isSetup());
  ipcMain.handle('pw-is-unlocked', () => ctx.pwManager.isUnlocked());
  ipcMain.handle('pw-setup', (_, pass) => ctx.pwManager.setMasterPassword(pass));
  ipcMain.handle('pw-unlock', (_, pass) => ctx.pwManager.unlock(pass));
  
  ipcMain.on('pw-lock', () => {
    ctx.pwManager.lock();
    ctx.broadcast('pw-locked');
  });

  ipcMain.handle('pw-save', (_, domain, username, password) => ctx.pwManager.save(domain, username, password));
  ipcMain.handle('pw-get', (_, domain) => ctx.pwManager.get(domain));
  ipcMain.handle('pw-get-all', () => ctx.pwManager.getAll());
  ipcMain.handle('pw-delete', (_, domain, username) => ctx.pwManager.delete(domain, username));
  ipcMain.handle('pw-search', (_, q) => ctx.pwManager.search(q));

  ipcMain.on('pw-captured', (event, domain, username, password) => {
    const wc = event.sender;
    ctx.pendingCredentials.set(wc.id, { domain, username, password });
  });

  ipcMain.handle('pw-save-pending', (event, tabId) => {
    const view = ctx.getViewByTabId(event.sender, tabId);
    if (!view) return false;
    const cred = ctx.pendingCredentials.get(view.webContents.id);
    if (cred) {
      if (ctx.pwManager.isUnlocked()) {
        ctx.pwManager.save(cred.domain, cred.username, cred.password);
      }
      ctx.pendingCredentials.delete(view.webContents.id);
      return true;
    }
    return false;
  });

  ipcMain.on('pw-discard-pending', (event, tabId) => {
    const view = ctx.getViewByTabId(event.sender, tabId);
    if (view) {
      ctx.pendingCredentials.delete(view.webContents.id);
    }
  });
};
