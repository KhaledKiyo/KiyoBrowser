module.exports = function registerBookmarksIPC(ipcMain, ctx) {
  ipcMain.handle('get-bookmarks', () => ctx.getBookmarks());

  ipcMain.handle('is-bookmarked', (_, url) => ctx.getBookmarks().some(b => b.url === url));

  ipcMain.on('add-bookmark', (_, bookmark) => {
    const bookmarks = ctx.getBookmarks();
    if (!bookmarks.some(b => b.url === bookmark.url)) {
      bookmarks.unshift({ 
        url: bookmark.url, 
        title: bookmark.title || bookmark.url, 
        addedAt: Date.now() 
      });
      if (bookmarks.length > ctx.MAX_BOOKMARKS) bookmarks.pop();
      ctx.setBookmarks(bookmarks);
      ctx.saveBookmarks();
      ctx.broadcast('bookmarks-updated', bookmarks);
    }
  });

  ipcMain.on('remove-bookmark', (_, url) => {
    const bookmarks = ctx.getBookmarks().filter(b => b.url !== url);
    ctx.setBookmarks(bookmarks);
    ctx.saveBookmarks();
    ctx.broadcast('bookmarks-updated', bookmarks);
  });
};
