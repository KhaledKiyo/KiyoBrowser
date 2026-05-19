const fs = require('fs');
const path = require('path');
const { session } = require('electron');
const AdmZip = require('adm-zip');

module.exports = function registerExtensionsIPC(ipcMain, ctx) {

  // List all installed extensions
  ipcMain.handle('ext-list', () => {
    const exts = session.defaultSession.getAllExtensions();
    return Object.values(exts).map(e => ({
      id: e.id,
      name: e.manifest.name,
      version: e.manifest.version,
      description: e.manifest.description || '',
      iconUrl: e.manifest.icons
        ? `chrome-extension://${e.id}/${Object.values(e.manifest.icons).pop()}`
        : null,
      enabled: true,
    }));
  });

  // Install from unpacked directory (developer mode)
  ipcMain.handle('ext-install-unpacked', async (_, dirPath) => {
    try {
      // 1. Load extension from raw user directory to find its ID
      const tempExt = await session.defaultSession.loadExtension(dirPath, { allowFileAccess: true });
      const extId = tempExt.id;
      const manifest = tempExt.manifest;

      // 2. Unload the raw directory instance immediately
      session.defaultSession.removeExtension(extId);

      // 3. Copy the extension to the persistent folder
      const destDir = path.join(ctx.EXTENSIONS_PATH, extId);
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true });
      }
      fs.cpSync(dirPath, destDir, { recursive: true });

      // 4. Load extension permanently from the stable, persistent directory
      await session.defaultSession.loadExtension(destDir, { allowFileAccess: true });

      ctx.broadcast('ext-installed', {
        id: extId,
        name: manifest.name,
        version: manifest.version,
      });
      return { success: true, id: extId };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Install from .zip or .crx file
  ipcMain.handle('ext-install-zip', async (_, zipPath) => {
    try {
      const zip = new AdmZip(zipPath);
      const manifestEntry = zip.getEntry('manifest.json');
      if (!manifestEntry) return { success: false, error: 'Not a valid extension — missing manifest.json' };

      // 1. Extract to a transient extraction directory inside EXTENSIONS_PATH
      const tempDir = path.join(ctx.EXTENSIONS_PATH, '_installing_' + Date.now());
      zip.extractAllTo(tempDir, true);

      // 2. Load transient instance to find its assigned ID
      const tempExt = await session.defaultSession.loadExtension(tempDir, { allowFileAccess: true });
      const extId = tempExt.id;
      const manifest = tempExt.manifest;

      // 3. Unload the transient instance
      session.defaultSession.removeExtension(extId);

      // 4. Move transient folder to final folder named after its ID
      const finalDir = path.join(ctx.EXTENSIONS_PATH, extId);
      if (fs.existsSync(finalDir)) {
        fs.rmSync(finalDir, { recursive: true, force: true });
      }
      fs.renameSync(tempDir, finalDir);

      // 5. Load extension permanently from the final, stable directory
      await session.defaultSession.loadExtension(finalDir, { allowFileAccess: true });

      ctx.broadcast('ext-installed', { id: extId, name: manifest.name, version: manifest.version });
      return { success: true, id: extId };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Remove extension
  ipcMain.handle('ext-remove', async (_, extId) => {
    try {
      await session.defaultSession.removeExtension(extId);
      const extDir = path.join(ctx.EXTENSIONS_PATH, extId);
      if (fs.existsSync(extDir)) fs.rmSync(extDir, { recursive: true, force: true });
      ctx.broadcast('ext-removed', extId);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Open file picker to install unpacked extension (dev mode)
  ipcMain.handle('ext-open-file-dialog', async (event) => {
    const { dialog } = require('electron');
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Extension Folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Open .zip/.crx file picker
  ipcMain.handle('ext-open-zip-dialog', async (event) => {
    const { dialog } = require('electron');
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Extension File',
      filters: [{ name: 'Extension', extensions: ['zip', 'crx'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
};
