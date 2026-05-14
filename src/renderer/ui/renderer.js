// ─── Element refs ─────────────────────────────────────────────────────────────
const urlInput = document.getElementById('url-input');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const loader = document.getElementById('loader');
const tabsBar = document.getElementById('tabs-bar');
const addTabBtn = document.getElementById('add-tab-btn');
const privateWindowBtn = document.getElementById('private-window-btn');
const noteBtn = document.getElementById('note-btn');
const downloadsToggle = document.getElementById('downloads-toggle');
const downloadBadge = document.getElementById('download-badge');
const securityIndicator = document.getElementById('security-indicator');
const logo = document.querySelector('.logo');
const menuBtn = document.getElementById('menu-btn');
const bookmarksBtn = document.getElementById('bookmarks-btn');
const historyBtn = document.getElementById('history-btn');
const bookmarkStarBtn = document.getElementById('bookmark-star-btn');
const autocompleteList = document.getElementById('autocomplete-list');

const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findResults = document.getElementById('find-results');
const findPrev = document.getElementById('find-prev');
const findNext = document.getElementById('find-next');
const findClose = document.getElementById('find-close');

// ─── State ────────────────────────────────────────────────────────────────────
let activeTabId = null;
let unseenDownloads = 0;
let activeDownloads = 0;
let lastDownloadsViewedAt = Date.now();
let MAX_TABS = 20;  // overridden by main on ready
let currentUrl = '';  // url of the active tab (for bookmark star)
const tabs = new Map(); // id → { title, url, favicon }
let isPrivateWindow = false;

let acSelectedIndex = -1;
let acResults = [];

// ─── Tab ID counter (monotonic — avoids Date.now() collision) ─────────────────
function nextTabId() { return self.crypto.randomUUID(); }

// Bug #20: track favicon load timers per tab so they can be cancelled on tab close
const _faviconTimers = new Map();

// Bug #23: prevent double-click race from creating an orphan DOM tab
let _tabCreating = false;



// ─── Context menu ─────────────────────────────────────────────────────────────
let activeMenu = null;

function removeContextMenu() {
  if (activeMenu) { activeMenu.remove(); activeMenu = null; }
  document.removeEventListener('click', removeContextMenu);
  document.removeEventListener('keydown', onMenuKeydown);
}

function onMenuKeydown(e) { if (e.key === 'Escape') removeContextMenu(); }

function showTabContextMenu(tabId, x, y) {
  window.electronAPI.showTabMenu(tabId);
}

window.electronAPI.onTabMenuAction((id, action) => {
  if (action === 'duplicate') window.electronAPI.duplicateTab(id);
  if (action === 'close') closeTab(id);
});

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function createTab(url = null, existingId = null) {
  // Bug #23: guard against double-click creating an orphan DOM tab
  if (_tabCreating) return;
  if (tabs.size >= MAX_TABS) { showToast('Tab limit reached (' + MAX_TABS + ' max)', 'error'); return; }
  _tabCreating = true;
  const id = existingId || nextTabId();
  window.electronAPI.createTab(id, url);

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.id = `tab-${id}`;
  tabEl.setAttribute('data-title', 'New Tab');
  tabEl.innerHTML = `<span class="tab-icon"><i data-lucide="globe"></i></span>`;
  tabsBar.appendChild(tabEl);
  lucide.createIcons({ attrs: { "stroke-width": 2, "class": "lucide" }, nodes: [tabEl] });

  tabEl.addEventListener('click', () => switchTab(id));
  tabEl.addEventListener('contextmenu', e => { e.preventDefault(); showTabContextMenu(id, e.clientX, e.clientY); });

  tabs.set(id, { title: 'New Tab', url, favicon: null });
  switchTab(id);
  updateAddTabButton();
  saveSession();
  _tabCreating = false;
  return id;
}

function switchTab(id) {
  if (activeTabId === id) return;
  document.getElementById(`tab-${activeTabId}`)?.classList.remove('active');
  activeTabId = id;
  document.getElementById(`tab-${id}`)?.classList.add('active');
  window.electronAPI.switchTab(id);
  // Refresh bookmark star for the newly active tab
  const data = tabs.get(id);
  if (data?.url) updateBookmarkStar(data.url);
}

function closeTab(id) {
  window.electronAPI.closeTab(id);
  document.getElementById(`tab-${id}`)?.remove();
  tabs.delete(id);
  // Bug #20: clear pending favicon timer so it doesn't write to a detached element
  if (_faviconTimers.has(id)) { clearTimeout(_faviconTimers.get(id)); _faviconTimers.delete(id); }
  if (activeTabId === id) {
    activeTabId = null;
    const keys = [...tabs.keys()];
    if (keys.length) switchTab(keys[keys.length - 1]);
    else createTab();
  }
  updateAddTabButton();
  saveSession();
}

function updateAddTabButton() {
  addTabBtn.disabled = tabs.size >= MAX_TABS;
  addTabBtn.style.opacity = tabs.size >= MAX_TABS ? '0.35' : '';
}

// ─── Session persistence ──────────────────────────────────────────────────────
let _sessionTimer = null;
function saveSession() {
  if (isPrivateWindow) return; // Never save session data from a private window
  if (_sessionTimer) clearTimeout(_sessionTimer);
  _sessionTimer = setTimeout(() => {
    const sessionTabs = [...tabs.entries()].map(([id, data]) => ({
      id, url: data.url || 'home', title: data.title,
    }));
    window.electronAPI.saveSession({ tabs: sessionTabs, activeTabId });
  }, 1000);
}

// ─── Bookmark star ────────────────────────────────────────────────────────────
async function updateBookmarkStar(url) {
  if (!bookmarkStarBtn) return;
  if (!url || url.startsWith('kiyo://') || url === '') {
    bookmarkStarBtn.style.opacity = '0.3';
    bookmarkStarBtn.style.pointerEvents = 'none';
    return;
  }
  bookmarkStarBtn.style.opacity = '';
  bookmarkStarBtn.style.pointerEvents = '';
  const starred = await window.electronAPI.isBookmarked(url);
  bookmarkStarBtn.innerHTML = starred
    ? `<i data-lucide="star" style="fill:var(--arch-blue);color:var(--arch-blue)"></i>`
    : `<i data-lucide="star"></i>`;
  lucide.createIcons({ attrs: { "stroke-width": 2, "class": "lucide" }, nodes: [bookmarkStarBtn] });
}

async function toggleBookmark() {
  if (!currentUrl || currentUrl.startsWith('kiyo://')) return;
  const starred = await window.electronAPI.isBookmarked(currentUrl);
  if (starred) {
    window.electronAPI.removeBookmark(currentUrl);
    showToast('Bookmark removed');
  } else {
    const tabData = tabs.get(activeTabId);
    window.electronAPI.addBookmark({ url: currentUrl, title: tabData?.title || currentUrl });
    showToast('Bookmarked!');
  }
  updateBookmarkStar(currentUrl);
}

// ─── Security indicator ───────────────────────────────────────────────────────
function updateSecurityIndicator(url) {
  let icon = 'globe';
  let color = 'var(--text-dim)';
  if (isPrivateWindow) {
    icon = 'shield';
    color = 'var(--text-dim)';
  } else if (!url) {
    icon = 'home';
    color = 'var(--text-dim)';
  } else if (url.startsWith('https://')) {
    icon = 'shield-check';
    color = 'var(--arch-blue)';
  } else if (url.startsWith('kiyo://')) {
    icon = 'command';
    color = 'var(--arch-blue)';
  } else if (url.startsWith('http://')) {
    icon = 'shield-off';
    color = '#f0a500';
  }
  securityIndicator.innerHTML = `<i data-lucide="${icon}"></i>`;
  securityIndicator.style.color = color;
  lucide.createIcons({ attrs: { "stroke-width": 2, "class": "lucide" }, nodes: [securityIndicator] });
}

// ─── Toast notification ───────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  Object.assign(t.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    background: type === 'error' ? '#3a1010' : '#111318',
    border: `1px solid ${type === 'error' ? 'rgba(255,77,77,0.3)' : 'rgba(255,255,255,0.1)'}`,
    color: type === 'error' ? '#ff8080' : '#e6edf3',
    padding: '10px 20px', borderRadius: '12px', fontSize: '13px',
    fontFamily: 'Inter, sans-serif', zIndex: '99998',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)', animation: 'kiyoMenuIn 0.2s ease',
  });
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ─── Download badge helpers ───────────────────────────────────────────────────
function updateDownloadBadge() {
  const count = activeDownloads + unseenDownloads;
  if (count > 0) {
    downloadBadge.style.display = 'flex';
    downloadBadge.textContent = count;
  } else {
    downloadBadge.style.display = 'none';
  }
}

// ─── IPC listeners ────────────────────────────────────────────────────────────
window.electronAPI.onUrlChanged((id, url) => {
  const data = tabs.get(id);
  if (!data) return;
  data.url = url;
  if (activeTabId === id) {
    currentUrl = url;
    urlInput.value = url;
    updateSecurityIndicator(url);
    updateBookmarkStar(url);
  }
  saveSession();
});

window.electronAPI.onTitleChanged((id, title) => {
  const data = tabs.get(id);
  if (!data) return;
  data.title = title;
  const el = document.getElementById(`tab-${id}`);
  if (el) {
    el.setAttribute('data-title', title || 'New Tab');
  }
  saveSession();
});

window.electronAPI.onFaviconChanged((id, favicon) => {
  const data = tabs.get(id);
  if (!data) return;
  data.favicon = favicon;
  const el = document.getElementById(`tab-${id}`);
  if (!el) return;
  const icon = el.querySelector('.tab-icon');
  const img = document.createElement('img');
  img.src = favicon;
  // Bug #20: track timer per tab so we can cancel it if the tab closes
  if (_faviconTimers.has(id)) clearTimeout(_faviconTimers.get(id));
  const timer = setTimeout(() => {
    _faviconTimers.delete(id);
    if (!document.getElementById(`tab-${id}`)) return; // tab already closed
    icon.innerHTML = '<i data-lucide="globe"></i>';
    lucide.createIcons({
      attrs: {
        'stroke-width': 2,
        'class': 'lucide'
      },
      nodes: [icon]
    });
  }, 1500);
  _faviconTimers.set(id, timer);
  img.loading = 'eager';
  img.decoding = 'async';
  img.onload = () => { clearTimeout(timer); _faviconTimers.delete(id); icon.innerHTML = ''; icon.appendChild(img); };
  img.onerror = () => { 
    clearTimeout(timer); 
    _faviconTimers.delete(id); 
    icon.innerHTML = '<i data-lucide="globe"></i>'; 
    lucide.createIcons({
      attrs: {
        'stroke-width': 2,
        'class': 'lucide'
      },
      nodes: [icon]
    }); 
  };
});

window.electronAPI.onLoadingStatus((id, loading) => {
  if (activeTabId !== id) return;
  if (loading) {
    loader.style.display = 'block';
    loader.style.opacity = '1';
    loader.classList.add('active');
    // Start at 30% and move to 70% slowly
    loader.style.width = '30%';
    setTimeout(() => {
      if (loader.classList.contains('active')) {
        loader.style.width = '70%';
      }
    }, 100);
  } else {
    loader.style.width = '100%';
    loader.classList.remove('active');
    setTimeout(() => {
      if (!loader.classList.contains('active')) {
        loader.style.opacity = '0';
        setTimeout(() => {
          if (!loader.classList.contains('active')) {
            loader.style.display = 'none';
            loader.style.width = '0%';
          }
        }, 300);
      }
    }, 200);
  }
  if (!loading) document.querySelector('.initial-load-placeholder')?.remove();
});

window.electronAPI.onTabDuplicated((id, url) => {
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.id = `tab-${id}`;
  tabEl.setAttribute('data-title', 'New Tab');
  tabEl.innerHTML = `<span class="tab-icon"><i data-lucide="globe"></i></span>`;
  tabsBar.appendChild(tabEl);
  lucide.createIcons({ attrs: { "stroke-width": 2, "class": "lucide" }, nodes: [tabEl] });
  tabEl.addEventListener('click', () => switchTab(id));
  tabEl.addEventListener('contextmenu', e => { e.preventDefault(); showTabContextMenu(id, e.clientX, e.clientY); });
  tabs.set(id, { title: 'New Tab', url, favicon: null });
  switchTab(id);
  updateAddTabButton();
  saveSession();
});

window.electronAPI.onTabLimitReached(() => showToast('Tab limit reached (' + MAX_TABS + ' max)', 'error'));

// Downloads — badge counts unseen completed + in-progress
window.electronAPI.onDownloadsUpdated(downloads => {
  activeDownloads = downloads.filter(d => d.state === 'progressing').length;
  // Unseen are those completed after we last opened the downloads page
  unseenDownloads = downloads.filter(d => d.state === 'completed' && d.startedAt > lastDownloadsViewedAt).length;
  updateDownloadBadge();
});

window.electronAPI.onDownloadsCleared(() => {
  activeDownloads = 0;
  unseenDownloads = 0;
  updateDownloadBadge();
});

window.electronAPI.onBookmarksUpdated(() => {
  updateBookmarkStar(currentUrl);
});

// Keyboard shortcuts from main
window.electronAPI.onShortcut(name => {
  if (name === 'new-tab') createTab();
  if (name === 'close-tab') { if (activeTabId) closeTab(activeTabId); }
  if (name === 'focus-url') { urlInput.focus(); urlInput.select(); }
  if (name === 'open-downloads') { unseenDownloads = 0; updateDownloadBadge(); window.electronAPI.navigate('downloads'); }
  if (name === 'open-settings') window.electronAPI.navigate('settings');
  if (name === 'open-bookmarks') window.electronAPI.navigate('bookmarks');
  if (name === 'open-history') window.electronAPI.navigate('history');
  if (name === 'toggle-bookmark') toggleBookmark();
  if (name === 'open-find') {
    findBar.style.display = 'flex';
    findInput.focus();
    findInput.select();
    if (findInput.value) window.electronAPI.findInPage(findInput.value);
  }
  if (name === 'zoom-in') changeZoom(0.5);
  if (name === 'zoom-out') changeZoom(-0.5);
  if (name === 'zoom-reset') resetZoom();
});

async function changeZoom(delta) {
  const current = await window.electronAPI.getZoom();
  const next = Math.min(Math.max(current + delta, -3), 3);
  window.electronAPI.setZoom(next);
  const pct = Math.round(Math.pow(1.2, next) * 100);
  showToast(`Zoom: ${pct}%`);
}

function resetZoom() {
  window.electronAPI.setZoom(0);
  showToast('Zoom Reset');
}

// ─── UI event listeners ───────────────────────────────────────────────────────
addTabBtn.addEventListener('click', () => createTab());
logo.addEventListener('click', () => window.electronAPI.navigate('home'));

urlInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (acSelectedIndex >= 0) return; // autocomplete handler takes over
  let url = urlInput.value.trim();
  if (!url) return;
  if (url === 'kiyo://settings') url = 'settings';
  if (url === 'kiyo://downloads') url = 'downloads';
  if (url === 'kiyo://bookmarks') url = 'bookmarks';
  if (url === 'kiyo://history') url = 'history';
  window.electronAPI.navigate(url);
  urlInput.blur();
  hideAutocomplete();
});

urlInput.addEventListener('input', async () => {
  const text = urlInput.value.trim();
  if (text.length < 2) { hideAutocomplete(); return; }
  acResults = await window.electronAPI.getAutocomplete(text);
  if (acResults.length > 0) renderAutocomplete(acResults);
  else hideAutocomplete();
});

urlInput.addEventListener('keydown', e => {
  if (autocompleteList.style.display === 'none') return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acSelectedIndex = Math.min(acSelectedIndex + 1, acResults.length - 1);
    updateACSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acSelectedIndex = Math.max(acSelectedIndex - 1, -1);
    updateACSelection();
  } else if (e.key === 'Enter' && acSelectedIndex >= 0) {
    e.preventDefault();
    const selected = acResults[acSelectedIndex];
    urlInput.value = selected.url;
    window.electronAPI.navigate(selected.url);
    hideAutocomplete();
    urlInput.blur();
  } else if (e.key === 'Escape') {
    hideAutocomplete();
  }
});

function renderAutocomplete(results) {
  autocompleteList.innerHTML = '';
  results.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'ac-item';
    let icon = 'history';
    if (r.type === 'bookmark') icon = 'star';
    if (r.type === 'search') icon = 'search';
    
    item.innerHTML = `
      <div class="ac-icon"><i data-lucide="${icon}"></i></div>
      <div class="ac-info">
        <span class="ac-title">${r.title}</span>
        <span class="ac-url">${r.url}</span>
      </div>
    `;
    item.addEventListener('click', () => {
      urlInput.value = r.url;
      window.electronAPI.navigate(r.url);
      hideAutocomplete();
    });
    autocompleteList.appendChild(item);
  });
  autocompleteList.style.display = 'block';
  acSelectedIndex = -1;
  lucide.createIcons({ attrs: { "stroke-width": 2, "class": "lucide" }, nodes: [autocompleteList] });
}

function updateACSelection() {
  const items = autocompleteList.querySelectorAll('.ac-item');
  items.forEach((item, i) => {
    item.classList.toggle('active', i === acSelectedIndex);
  });
}

function hideAutocomplete() {
  autocompleteList.style.display = 'none';
  acSelectedIndex = -1;
}

document.addEventListener('click', e => {
  if (!urlInput.contains(e.target) && !autocompleteList.contains(e.target)) {
    hideAutocomplete();
  }
});

urlInput.addEventListener('focus', () => urlInput.select());
backBtn.addEventListener('click', () => window.electronAPI.goBack());
forwardBtn.addEventListener('click', () => window.electronAPI.goForward());
reloadBtn.addEventListener('click', () => window.electronAPI.reload());

downloadsToggle.addEventListener('click', () => {
  lastDownloadsViewedAt = Date.now();
  unseenDownloads = 0;
  updateDownloadBadge();
  window.electronAPI.navigate('downloads');
});

menuBtn.addEventListener('click', () => window.electronAPI.navigate('settings'));

if (privateWindowBtn) privateWindowBtn.addEventListener('click', () => window.electronAPI.openPrivateWindow());
if (noteBtn) noteBtn.addEventListener('click', () => createTab('kiyo://note'));
if (bookmarksBtn) bookmarksBtn.addEventListener('click', () => window.electronAPI.navigate('bookmarks'));
if (historyBtn) historyBtn.addEventListener('click', () => window.electronAPI.navigate('history'));
if (bookmarkStarBtn) bookmarkStarBtn.addEventListener('click', toggleBookmark);

findInput.addEventListener('input', () => {
  const text = findInput.value;
  if (text) window.electronAPI.findInPage(text);
  else {
    window.electronAPI.stopFindInPage('clearSelection');
    findResults.textContent = '0/0';
  }
});

findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    window.electronAPI.findInPage(findInput.value, { forward: !e.shiftKey, findNext: true });
  } else if (e.key === 'Escape') {
    closeFind();
  }
});

findPrev.addEventListener('click', () => window.electronAPI.findInPage(findInput.value, { forward: false, findNext: true }));
findNext.addEventListener('click', () => window.electronAPI.findInPage(findInput.value, { forward: true, findNext: true }));
findClose.addEventListener('click', closeFind);

function closeFind() {
  findBar.style.display = 'none';
  window.electronAPI.stopFindInPage('clearSelection');
}

window.electronAPI.onFoundInPage(result => {
  if (result.activeMatchOrdinal !== undefined) {
    findResults.textContent = `${result.activeMatchOrdinal}/${result.matches}`;
  }
});

// ─── Boot — uses IPC handshake instead of setTimeout ─────────────────────────
(async () => {
  const data = await window.electronAPI.rendererReady();
  if (!data) return;

  const { settings, maxTabs, session, isPrivate } = data;
  MAX_TABS = maxTabs;
  isPrivateWindow = isPrivate;

  if (isPrivateWindow) {
    document.body.classList.add('private-mode');
  }

  if (session && session.tabs && session.tabs.length > 0) {
    for (const tab of session.tabs) {
      createTab(tab.url || 'home', tab.id);
    }
    if (session.activeTabId && tabs.has(session.activeTabId)) {
      switchTab(session.activeTabId);
    }
  } else {
    createTab();
  }
  updateAddTabButton();
  document.querySelector('.initial-load-placeholder')?.remove();
})();
