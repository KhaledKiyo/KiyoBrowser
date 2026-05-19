// ─── DOM Elements ─────────────────────────────────────────────────────────────
const backBtn = document.getElementById('back-btn');
const originalBtn = document.getElementById('original-btn');
const fontSizeBtn = document.getElementById('font-size-btn');
const fontSizeMenu = document.getElementById('font-size-menu');
const menuItems = document.querySelectorAll('.menu-item');

const sourceDomain = document.getElementById('source-domain');
const articleTitle = document.getElementById('article-title');
const articleByline = document.getElementById('article-byline');
const readTime = document.getElementById('read-time');
const articleContent = document.getElementById('article-content');

let originalUrl = '';

// ─── Initialize Reader Mode ───────────────────────────────────────────────────
async function initReader() {
  lucide.createIcons();
  
  // Restore font size from localStorage
  const savedFont = localStorage.getItem('kiyo-reader-font') || 'medium';
  document.body.className = `font-size-${savedFont}`;
  menuItems.forEach(i => {
    if (i.getAttribute('data-size') === savedFont) {
      i.classList.add('active');
    } else {
      i.classList.remove('active');
    }
  });

  let articleData = null;

  // Retrieve data from main process IPC (robust, cross-process safe)
  if (window.electronAPI && window.electronAPI.getReaderArticle) {
    try {
      articleData = await window.electronAPI.getReaderArticle();
    } catch (e) {
      console.error('Failed to fetch reader article from main process', e);
    }
  }

  // Fallback to URL search params
  if (!articleData) {
    const params = new URLSearchParams(window.location.search);
    if (params.has('content')) {
      articleData = {
        title: params.get('title') || 'Untitled Article',
        byline: params.get('byline') || '',
        content: params.get('content'),
        url: params.get('url') || ''
      };
    }
  }

  if (articleData && articleData.content) {
    renderArticle(articleData);
  } else {
    showError();
  }
}

// ─── Render Article ───────────────────────────────────────────────────────────
function renderArticle(data) {
  originalUrl = data.url;

  // Domain parsing
  try {
    const urlObj = new URL(data.url);
    sourceDomain.textContent = urlObj.hostname.replace(/^www\./, '');
  } catch (e) {
    sourceDomain.textContent = data.url || 'Unknown source';
  }

  // Text content
  articleTitle.textContent = data.title;
  articleByline.textContent = data.byline || '';
  articleContent.innerHTML = data.content;

  // Calculate Read Time
  const plainText = data.content.replace(/<[^>]*>?/gm, ''); // strip HTML tags
  const wordCount = plainText.split(/\s+/).filter(word => word.length > 0).length;
  const minutes = Math.max(1, Math.round(wordCount / 200));
  readTime.textContent = `~${minutes} min read`;
  
  // Extra styling for empty byline
  if (!data.byline) {
    articleByline.style.display = 'none';
  }
}

function showError() {
  articleTitle.textContent = 'Failed to Load Article';
  articleContent.innerHTML = '<p>We could not extract the article content from the previous page.</p>';
  sourceDomain.textContent = 'Error';
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

backBtn.addEventListener('click', () => {
  if (window.electronAPI && window.electronAPI.readerGoBack) {
    window.electronAPI.readerGoBack();
  } else if (window.electronAPI && window.electronAPI.goBack) {
    window.electronAPI.goBack();
  } else {
    window.history.back();
  }
});

originalBtn.addEventListener('click', () => {
  if (originalUrl) {
    if (window.electronAPI && window.electronAPI.navigate) {
      window.electronAPI.navigate(originalUrl);
    } else {
      window.location.href = originalUrl;
    }
  }
});

// Font size toggle
fontSizeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isVisible = fontSizeMenu.style.display === 'flex';
  fontSizeMenu.style.display = isVisible ? 'none' : 'flex';
});

document.addEventListener('click', (e) => {
  if (!fontSizeMenu.contains(e.target) && !fontSizeBtn.contains(e.target)) {
    fontSizeMenu.style.display = 'none';
  }
});

menuItems.forEach(item => {
  item.addEventListener('click', () => {
    // Update active class
    menuItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    // Change body class and save to localStorage
    const size = item.getAttribute('data-size');
    document.body.className = `font-size-${size}`;
    localStorage.setItem('kiyo-reader-font', size);
    
    // Close menu
    fontSizeMenu.style.display = 'none';
  });
});

// Initialize inside DOMContentLoaded to ensure preload is fully loaded
window.addEventListener('DOMContentLoaded', initReader);
