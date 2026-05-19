module.exports = function registerHistoryIPC(ipcMain, ctx) {
  ipcMain.handle('get-history', () => ctx.getHistory());

  ipcMain.on('clear-history', () => {
    ctx.setHistory([]);
    ctx.saveHistory();
    ctx.broadcast('history-updated');
  });

  ipcMain.on('remove-history-entry', (_, url) => {
    const history = ctx.getHistory().filter(h => h.url !== url);
    ctx.setHistory(history);
    ctx.saveHistory();
    ctx.broadcast('history-updated');
  });
};
