/**
 * readability.js
 * Lightweight, pure-JS article extractor for Kiyo Browser main process.
 * Do NOT use npm packages.
 */

/**
 * Tokenizes HTML into startTag, endTag, and text tokens.
 * Gracefully strips script/style tags and comments during tokenization.
 */
function tokenize(html) {
  const tokens = [];
  let pos = 0;
  const len = html.length;

  while (pos < len) {
    if (html[pos] === '<') {
      // Handle comments
      if (html.slice(pos, pos + 4) === '<!--') {
        const endComment = html.indexOf('-->', pos + 4);
        if (endComment !== -1) {
          pos = endComment + 3;
        } else {
          pos = len; // unclosed comment
        }
        continue;
      }

      // Find tag closing bracket
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

        // Skip script and style tags completely
        if (tagName === 'script' || tagName === 'style') {
          const closeTag = `</${tagName}>`;
          const endIdx = html.toLowerCase().indexOf(closeTag, pos);
          if (endIdx !== -1) {
            pos = endIdx + closeTag.length;
          } else {
            pos = len; // Unclosed script/style
          }
          continue;
        }

        // Parse attributes
        const attrs = {};
        const attrRegex = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        const attrStr = cleanTag.slice(match[0].length);
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
          const name = attrMatch[1].toLowerCase();
          const val = attrMatch[2] || attrMatch[3] || attrMatch[4] || '';
          attrs[name] = val;
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

/**
 * Builds a DOM-like tree structure from token list.
 */
function buildTree(tokens) {
  const root = { tagName: 'root', children: [], attrs: {} };
  const stack = [root];

  const selfClosingTags = new Set([
    'img', 'br', 'hr', 'input', 'meta', 'link', 'col', 'embed', 'param', 'source', 'track', 'wbr'
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
        children: []
      };
      stack[stack.length - 1].children.push(node);
      
      const isSelf = token.selfClosing || selfClosingTags.has(token.tagName);
      if (!isSelf) {
        stack.push(node);
      }
    } else if (token.type === 'endTag') {
      let i = stack.length - 1;
      while (i > 0 && stack[i].tagName !== token.tagName) {
        i--;
      }
      if (i > 0) {
        stack.splice(i);
      }
    }
  }

  return root;
}

/**
 * Depth-First Search to find the first node matching a predicate.
 */
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

/**
 * Depth-First Search to find all nodes matching a predicate.
 */
function findNodes(node, predicate, results) {
  if (predicate(node)) results.push(node);
  if (node.children) {
    for (const child of node.children) {
      findNodes(child, predicate, results);
    }
  }
}

/**
 * Recursively gets the text content of a node.
 */
function getTextContent(node) {
  if (node.type === 'text') return node.content;
  if (!node.children) return '';
  return node.children.map(getTextContent).join(' ');
}

/**
 * Recursively strips layout/comment/advertisement elements.
 */
function cleanTree(node) {
  if (!node.children) return;
  node.children = node.children.filter(child => {
    if (child.type === 'text') return true;

    const tag = child.tagName;
    const classes = child.attrs && child.attrs.class ? child.attrs.class.split(/\s+/) : [];
    const id = child.attrs && child.attrs.id ? child.attrs.id : '';

    // Tags to drop
    const dropTags = ['nav', 'header', 'footer', 'aside', 'script', 'style', 'iframe', 'noscript', 'form', 'button'];
    if (dropTags.includes(tag)) return false;

    // Class/ID heuristics to drop
    const dropPatterns = /(sidebar|ads|comments|footer|header|menu|nav|share|widget|social|promo|banner)/i;
    if (classes.some(c => dropPatterns.test(c)) || dropPatterns.test(id)) {
      return false;
    }

    cleanTree(child);
    return true;
  });
}

/**
 * Renders the cleaned DOM tree back into standard HTML string,
 * retaining only specific elements and attributes.
 */
function renderCleanHTML(node) {
  if (node.type === 'text') {
    return node.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const allowedTags = [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
    'img', 'a', 'ul', 'ol', 'li', 'blockquote', 
    'pre', 'code', 'em', 'strong', 'br'
  ];
  const tag = node.tagName;

  if (!allowedTags.includes(tag)) {
    // Unwrap element: render its children directly
    if (node.children) {
      return node.children.map(renderCleanHTML).join('');
    }
    return '';
  }

  let attrsStr = '';
  if (tag === 'img' && node.attrs && node.attrs.src) {
    attrsStr = ` src="${node.attrs.src}"`;
  } else if (tag === 'a' && node.attrs && node.attrs.href) {
    attrsStr = ` href="${node.attrs.href}" target="_blank"`;
  }

  if (tag === 'img' || tag === 'br') {
    return `<${tag}${attrsStr} />`;
  }

  const innerHTML = node.children ? node.children.map(renderCleanHTML).join('') : '';
  
  if (tag !== 'br' && !innerHTML.trim() && tag !== 'img') {
    return '';
  }

  return `<${tag}${attrsStr}>${innerHTML}</${tag}>`;
}

/**
 * Main article extractor.
 */
async function extractArticle(html, url) {
  const tokens = tokenize(html);
  const root = buildTree(tokens);

  // 1. Extract title
  let title = '';
  const titleTag = findNode(root, n => n.tagName === 'title');
  if (titleTag) {
    title = getTextContent(titleTag).trim();
  }
  if (!title) {
    const h1Tag = findNode(root, n => n.tagName === 'h1');
    if (h1Tag) title = getTextContent(h1Tag).trim();
  }
  // Clean title suffix like " | Medium"
  if (title) {
    title = title.replace(/\s+[\-\|•]\s+.*$/, '');
  }

  // 2. Extract byline
  let byline = '';
  const bylineNode = findNode(root, n => {
    if (!n.attrs) return false;
    if (n.attrs.rel === 'author') return true;
    const classes = n.attrs.class ? n.attrs.class.split(/\s+/) : [];
    return classes.includes('byline') || classes.includes('author') || classes.includes('by-author');
  });
  if (bylineNode) {
    byline = getTextContent(bylineNode).replace(/\s+/g, ' ').trim();
  }

  // 3. Heuristic search for the main container
  let mainContainer = null;
  const selectors = [
    n => n.tagName === 'article',
    n => n.attrs && n.attrs.role === 'main',
    n => n.attrs && n.attrs.class && n.attrs.class.split(/\s+/).includes('post-content'),
    n => n.attrs && n.attrs.class && n.attrs.class.split(/\s+/).includes('article-body'),
    n => n.attrs && n.attrs.id === 'content',
    n => n.tagName === 'main',
  ];

  for (const selector of selectors) {
    const matched = findNode(root, selector);
    if (matched) {
      const text = getTextContent(matched).trim();
      if (text.length > 200) {
        mainContainer = matched;
        break;
      }
    }
  }

  // Fallback to body tag or root
  if (!mainContainer) {
    mainContainer = findNode(root, n => n.tagName === 'body') || root;
  }

  const containerClone = JSON.parse(JSON.stringify(mainContainer));

  cleanTree(containerClone);
  const content = renderCleanHTML(containerClone);

  // Extract excerpt
  let excerpt = '';
  const pNodes = [];
  findNodes(containerClone, n => n.tagName === 'p', pNodes);
  if (pNodes.length > 0) {
    excerpt = getTextContent(pNodes[0]).trim().slice(0, 180);
    if (excerpt) excerpt += '...';
  } else {
    excerpt = getTextContent(containerClone).trim().slice(0, 180);
    if (excerpt) excerpt += '...';
  }

  return {
    title: title || 'Untitled Article',
    byline: byline || '',
    content,
    excerpt,
  };
}

/**
 * Checks if the HTML is article or blog-like.
 */
function isArticlePage(html) {
  const tokens = tokenize(html);
  const root = buildTree(tokens);

  // 1. Explicit article tag
  const articleNode = findNode(root, n => n.tagName === 'article');
  if (articleNode) {
    const text = getTextContent(articleNode).trim();
    if (text.length > 300) return true;
  }

  // 2. Count "substantial" paragraph tags
  const pNodes = [];
  findNodes(root, n => n.tagName === 'p', pNodes);

  let substantialPCount = 0;
  for (const p of pNodes) {
    const text = getTextContent(p).trim();
    if (text.length > 80 && text.split(/\s+/).length > 10) {
      substantialPCount++;
    }
  }

  return substantialPCount >= 3;
}

module.exports = {
  extractArticle,
  isArticlePage,
};
