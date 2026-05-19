const fs = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');

const EASYLIST_URL = 'https://easylist.to/easylist/easylist.txt';
const EASYPRIVACY_URL = 'https://easylist.to/easylist/easyprivacy.txt';
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

let stats = { blocked: 0 };
const exactDomains = new Set();
const stringMatches = [];
const ruleIndex = new Map();

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        fs.unlink(dest, () => reject(new Error(`Status: ${response.statusCode}`)));
        return;
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

function parseRuleLine(line) {
  line = line.trim();
  if (!line || line.startsWith('!')) return;
  if (line.includes('##') || line.includes('#?#') || line.includes('~')) return;

  let rule = line;
  const optIdx = rule.indexOf('$');
  if (optIdx !== -1) rule = rule.substring(0, optIdx);

  if (rule.startsWith('||')) {
    const end = rule.indexOf('^');
    if (end !== -1) {
      const domain = rule.substring(2, end);
      if (domain && !domain.includes('/')) {
        exactDomains.add(domain.toLowerCase());
        return;
      }
    }
  }

  let cleaned = rule.replace(/^[|*]+/, '').replace(/[|*^]+$/, '').toLowerCase();
  if (cleaned.length > 3) {
    stringMatches.push(cleaned);
    const prefix = cleaned.substring(0, 3);
    if (!ruleIndex.has(prefix)) ruleIndex.set(prefix, []);
    ruleIndex.get(prefix).push(cleaned);
  }
}

// Built-in custom rules that supplement EasyList
const BUILTIN_EXACT_DOMAINS = [
  'log.fc.yahoo.com', 'udcm.yahoo.com',
  'data.mistat.india.xiaomi.com', 'data.mistat.rus.xiaomi.com',
  'data.mistat.xiaomi.com',
];
const BUILTIN_PATTERNS = [
  '/pagead.js', '/widget/ads.', '/ads.js', '/ad.js',
];
for (const d of BUILTIN_EXACT_DOMAINS) exactDomains.add(d);
for (const p of BUILTIN_PATTERNS) {
  stringMatches.push(p);
  const prefix = p.substring(0, 3);
  if (!ruleIndex.has(prefix)) ruleIndex.set(prefix, []);
  ruleIndex.get(prefix).push(p);
}


function loadRules(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      parseRuleLine(line);
    }
  } catch (err) {
    console.error('[adblock] Error parsing rules:', err.message);
  }
}

async function initAdblock() {
  const userDataPath = app.getPath('userData');
  const easylistPath = path.join(userDataPath, 'easylist.txt');
  const easyprivacyPath = path.join(userDataPath, 'easyprivacy.txt');

  const checkAndUpdate = async (filePath, url) => {
    let needsDownload = true;
    if (fs.existsSync(filePath)) {
      const fileStats = fs.statSync(filePath);
      if (Date.now() - fileStats.mtimeMs < CACHE_MAX_AGE) {
        needsDownload = false;
      }
    }
    
    if (needsDownload) {
      try {
        console.log(`[adblock] Downloading ${url}...`);
        await downloadFile(url, filePath);
      } catch (err) {
        console.error(`[adblock] Download failed:`, err.message);
      }
    }
    
    if (fs.existsSync(filePath)) {
      loadRules(filePath);
    }
  };

  await Promise.all([
    checkAndUpdate(easylistPath, EASYLIST_URL),
    checkAndUpdate(easyprivacyPath, EASYPRIVACY_URL)
  ]);
  
  console.log(`[adblock] Loaded ${exactDomains.size} domains and ${stringMatches.length} patterns across ${ruleIndex.size} trigram buckets.`);
}

function getRootDomain(hostname) {
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  const commonTwoPartTLDs = new Set(['co.uk', 'com.au', 'net.au', 'org.uk', 'co.jp', 'com.br', 'co.in']);
  return commonTwoPartTLDs.has(lastTwo) ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
}

function shouldBlock(urlStr, resourceType) {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();

    if (exactDomains.has(hostname) || exactDomains.has(getRootDomain(hostname))) {
      return true;
    }

    const urlLower = urlStr.toLowerCase();
    const len = urlLower.length;
    if (len < 4) return false;

    const checkedPrefixes = new Set();
    for (let i = 0; i <= len - 3; i++) {
      const trigram = urlLower.substring(i, i + 3);
      if (checkedPrefixes.has(trigram)) continue;
      checkedPrefixes.add(trigram);

      const bucket = ruleIndex.get(trigram);
      if (bucket) {
        for (let j = 0; j < bucket.length; j++) {
          if (urlLower.includes(bucket[j])) return true;
        }
      }
    }

    return false;
  } catch (err) {
    return false;
  }
}

module.exports = {
  initAdblock,
  shouldBlock,
  getStats: () => stats,
  resetStats: () => { stats.blocked = 0; },
  incrementStats: () => { stats.blocked++; }
};
