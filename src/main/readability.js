/**
 * readability.js
 * Lightweight, pure-JS article extractor for Kiyo Browser main process.
 */

function tokenize(html) {
  const tokens = [];
  let pos = 0;
  const len = html.length;

  while (pos < len) {
    if (html[pos] === '<') {
      if (html.slice(pos, pos + 4) === '<!--') {
        const endComment = html.indexOf('-->', pos + 4);
        pos = endComment !== -1 ? endComment + 3 : len;
        continue;
      }

      const end = html.indexOf('>', pos);
      if (end === -1) {
        tokens.push({ type: 'text', content: html.slice(pos) });
        break;
      }

      const tagContent = html.slice(pos + 1, end);
      pos = end + 1;

      const isClosing = tagContent.startsWith('/');
      const isSelfClosing = tagContent.endsWith('/');
      const cleanTag = isClosing
        ? tagContent.slice(1)
        : (isSelfClosing ? tagContent.slice(0, -1) : tagContent);

      const match = cleanTag.trim().match(/^([^\s>]+)/);
      if (match) {
        const tagName = match[1].toLowerCase();

        if (tagName === 'script' || tagName === 'style') {
          const closeTag = `</${tagName}>`;
          const endIdx = html.toLowerCase().indexOf(closeTag, pos);
          pos = endIdx !== -1 ? endIdx + closeTag.length : len;
          continue;
        }

        const attrs = {};
        const attrRegex = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        const attrStr = cleanTag.slice(match[0].length);
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
          attrs[attrMatch[1].toLowerCase()] = attrMatch[2] || attrMatch[3] || attrMatch[4] || '';
        }

        tokens.push({
          type: isClosing ? 'endTag' : 'startTag',
          tagName,
          attrs,
          selfClosing: isSelfClosing,
        });
      }
    } else {
      const nextTag = html.indexOf('<', pos);
      if (nextTag === -1) {
        tokens.push({ type: 'text', content: html.slice(pos) });
        break;
      }
      tokens.push({ type: 'text', content: html.slice(pos, nextTag) });
      pos = nextTag;
    }
  }

  return tokens;
}

function buildTree(tokens) {
  const root = { tagName: 'root', children: [], attrs: {}, depth: 0 };
  const stack = [root];

  const selfClosingTags = new Set([
    'img', 'br', 'hr', 'input', 'meta', 'link', 'col', 'embed',
    'param', 'source', 'track', 'wbr', 'picture',
  ]);

  for (const token of tokens) {
    if (token.type === 'text') {
      if (token.content.trim()) {
        stack[stack.length - 1].children.push({ type: 'text', content: token.content });
      }
    } else if (token.type === 'startTag') {
      const node = {
        tagName: token.tagName,
        attrs: token.attrs,
        children: [],
        depth: stack.length,
      };
      stack[stack.length - 1].children.push(node);

      if (!token.selfClosing && !selfClosingTags.has(token.tagName)) {
        stack.push(node);
      }
    } else if (token.type === 'endTag') {
      let i = stack.length - 1;
      while (i > 0 && stack[i].tagName !== token.tagName) i--;
      if (i > 0) stack.splice(i);
    }
  }

  return root;
}

function findNode(node, predicate) {
  if (predicate(node)) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

function findNodes(node, predicate, results) {
  if (predicate(node)) results.push(node);
  if (node.children) {
    for (const child of node.children) {
      findNodes(child, predicate, results);
    }
  }
}

function getTextContent(node) {
  if (node.type === 'text') return node.content;
  if (!node.children) return '';
  return node.children.map(getTextContent).join(' ');
}

function cleanTree(node) {
  if (!node.children) return;

  // Tags to always drop regardless of depth
  const hardDropTags = new Set(['nav', 'footer', 'aside', 'script', 'style', 'iframe', 'noscript', 'form']);
  // Tags to drop only at shallow depth (site-level structure, not article-level)
  const shallowDropTags = new Set(['header']);
  // Class/ID patterns that indicate navigation/advertising elements
  const dropPatterns = /(sidebar|ads?|comments?|footer|header|menu|navbar|nav-|share|widget|social|promo|banner|cookie|popup|overlay|modal|subscribe)/i;

  node.children = node.children.filter(child => {
    if (child.type === 'text') return true;

    const tag = child.tagName;
    if (hardDropTags.has(tag)) return false;

    // Only drop <header> at shallow tree depth (site nav headers, depth <= 3)
    if (shallowDropTags.has(tag) && (child.depth || 0) <= 3) return false;

    const classes = child.attrs && child.attrs.class ? child.attrs.class.split(/\s+/) : [];
    const id = child.attrs && child.attrs.id ? child.attrs.id : '';

    if (classes.some(c => dropPatterns.test(c)) || dropPatterns.test(id)) return false;

    cleanTree(child);
    return true;
  });
}

function escapeText(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderCleanHTML(node) {
  if (node.type === 'text') {
    return escapeText(node.content);
  }

  // Tags rendered with their full element
  const blockTags = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote',
    'pre', 'code', 'em', 'strong', 'br',
    'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
    'sub', 'sup', 'mark', 'abbr', 'time',
    'hr', 'details', 'summary',
  ]);

  // Tags rendered as transparent (just render children, no wrapper)
  const passthroughTags = new Set(['div', 'span', 'section', 'article', 'main', 'header', 'aside', 'picture']);

  // Void elements
  const voidTags = new Set(['img', 'br', 'hr', 'source', 'wbr']);

  const tag = node.tagName;

  if (tag === 'img') {
    const src = node.attrs && (node.attrs.src || node.attrs['data-src'] || node.attrs['data-lazy-src'] || '');
    const alt = node.attrs && node.attrs.alt ? ` alt="${escapeText(node.attrs.alt)}"` : '';
    if (!src) return '';
    return `<img src="${src}"${alt} loading="lazy" />`;
  }

  if (tag === 'a') {
    const href = node.attrs && node.attrs.href ? node.attrs.href : '#';
    const children = node.children ? node.children.map(renderCleanHTML).join('') : '';
    if (!children.trim()) return '';
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${children}</a>`;
  }

  if (passthroughTags.has(tag)) {
    const children = node.children ? node.children.map(renderCleanHTML).join('') : '';
    return children;
  }

  if (blockTags.has(tag)) {
    if (voidTags.has(tag)) return `<${tag} />`;
    const children = node.children ? node.children.map(renderCleanHTML).join('') : '';
    if (!children.trim() && tag !== 'br' && tag !== 'hr') return '';
    return `<${tag}>${children}</${tag}>`;
  }

  // Unknown tag — render children transparently
  if (node.children) return node.children.map(renderCleanHTML).join('');
  return '';
}

// ─── Main exports ──────────────────────────────────────────────────────────────

/**
 * Extracts article data AND checks if it's an article page in one pass.
 * Returns { title, byline, content, excerpt, isArticle }
 */
async function extractArticle(html, url) {
  const tokens = tokenize(html);
  const root = buildTree(tokens);

  // 1. Title
  let title = '';
  const titleTag = findNode(root, n => n.tagName === 'title');
  if (titleTag) title = getTextContent(titleTag).trim();
  if (!title) {
    const h1 = findNode(root, n => n.tagName === 'h1');
    if (h1) title = getTextContent(h1).trim();
  }
  if (title) title = title.replace(/\s+[-|•]\s+.*$/, '').trim();

  // 2. Byline
  let byline = '';
  const bylineNode = findNode(root, n => {
    if (!n.attrs) return false;
    if (n.attrs.rel === 'author') return true;
    const classes = n.attrs.class ? n.attrs.class.split(/\s+/) : [];
    return classes.some(c => /^(byline|author|by-author|post-author|article-author)$/i.test(c));
  });
  if (bylineNode) byline = getTextContent(bylineNode).replace(/\s+/g, ' ').trim();

  // 3. Find main content container
  const ARTICLE_SELECTORS = [
    n => n.tagName === 'article',
    n => n.attrs && n.attrs.role === 'main',
    n => n.attrs && n.attrs.id === 'article',
    n => n.attrs && n.attrs.id === 'content',
    n => n.attrs && n.attrs.id === 'main',
    n => n.attrs && n.attrs.class && /\b(post-content|article-body|article-content|entry-content|story-body|page-content)\b/.test(n.attrs.class),
    n => n.tagName === 'main',
  ];

  let mainContainer = null;
  for (const selector of ARTICLE_SELECTORS) {
    const matched = findNode(root, selector);
    if (matched && getTextContent(matched).trim().length > 200) {
      mainContainer = matched;
      break;
    }
  }
  if (!mainContainer) {
    mainContainer = findNode(root, n => n.tagName === 'body') || root;
  }

  // 4. Determine isArticle using the already-built root (no second parse!)
  const articleNode = findNode(root, n => n.tagName === 'article');
  let isArticle = false;
  if (articleNode && getTextContent(articleNode).trim().length > 300) {
    isArticle = true;
  } else {
    const pNodes = [];
    findNodes(root, n => n.tagName === 'p', pNodes);
    const substantialPs = pNodes.filter(p => {
      const t = getTextContent(p).trim();
      return t.length > 80 && t.split(/\s+/).length > 10;
    });
    isArticle = substantialPs.length >= 3;
  }

  // 5. Clean and render
  const containerClone = JSON.parse(JSON.stringify(mainContainer));
  cleanTree(containerClone);
  const content = renderCleanHTML(containerClone);

  // 6. Excerpt
  let excerpt = '';
  const pNodes = [];
  findNodes(containerClone, n => n.tagName === 'p', pNodes);
  const excerptSource = pNodes.length > 0 ? getTextContent(pNodes[0]) : getTextContent(containerClone);
  excerpt = excerptSource.trim().slice(0, 180);
  if (excerpt) excerpt += '...';

  return {
    title: title || 'Untitled Article',
    byline: byline || '',
    content,
    excerpt,
    isArticle,
  };
}

/**
 * Lightweight check — prefers cached result from extractArticle if available.
 * Only parses HTML directly if no cached data is provided.
 */
function isArticlePage(html) {
  const tokens = tokenize(html);
  const root = buildTree(tokens);

  const articleNode = findNode(root, n => n.tagName === 'article');
  if (articleNode && getTextContent(articleNode).trim().length > 300) return true;

  const pNodes = [];
  findNodes(root, n => n.tagName === 'p', pNodes);
  const substantialPs = pNodes.filter(p => {
    const t = getTextContent(p).trim();
    return t.length > 80 && t.split(/\s+/).length > 10;
  });
  return substantialPs.length >= 3;
}

module.exports = { extractArticle, isArticlePage };
