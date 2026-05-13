const { session } = require('electron');
const dns = require('node:dns/promises');

// ─── Privacy Shield v2 ───────────────────────────────────────────────────────

const DOMAIN_CACHE = new Map();
const CNAME_CACHE = new Map();
const CNAME_PENDING = new Set();
const COSMETIC_KEY_BY_WEBCONTENTS = new WeakMap();

// surgical tracker/ad/telemetry endpoints
const BLOCKED_DOMAINS = new Set([
  // Core Ad Networks
  'doubleclick.net', 'googleadservices.com', 'googlesyndication.com', 'adnxs.com',
  'adform.net', 'adservice.google.com', 'amazon-adsystem.com', 'taboola.com',
  'outbrain.com', 'zemanta.com', 'criteo.com', 'criteo.net', 'openx.net',
  'pubmatic.com', 'rubiconproject.com', 'casalemedia.com', 'yieldmo.com',
  'smartadserver.com', 'bidswitch.net', 'lijit.com', 'adnxs-simple.com',
  'adcolony.com', 'media.net', 'unityads.unity3d.com',
  
  // Analytics & Modern Trackers
  'google-analytics.com', 'analytics.google.com', 'googletagmanager.com',
  'googleoptimize.com', 'clarity.ms', 'cloudflareinsights.com',
  'quantserve.com', 'scorecardresearch.com', 'hotjar.com', 'hotjar.io',
  'mouseflow.com', 'luckyorange.com', 'luckyorange.net', 'freshmarketer.com',
  'mixpanel.com', 'amplitude.com', 'newrelic.com', 'nr-data.net',
  'sentry.io', 'sentry-cdn.com', 'getsentry.com', 'getsentry.io',
  'fullstory.com', 'logrocket.io', 'bugsnag.com', 'bugsnag.io',
  'stats.wp.com', 'pixel.facebook.com', 'googleanalytics.com',
  '2o7.net', 'omtrdc.net', 'connect.facebook.net', 'an.facebook.com',
  
  // Social Trackers
  'ads.tiktok.com', 'analytics.tiktok.com', 'ads-sg.tiktok.com', 'analytics-sg.tiktok.com',
  'business-api.tiktok.com', 'ads-api.tiktok.com', 'byteoversea.com', 'tiktokcdn.com',
  'ads-twitter.com', 'ads-api.twitter.com', 'trk.pinterest.com', 'log.pinterest.com',
  'ads.pinterest.com', 'events.reddit.com', 'events.redditmedia.com',
  'ads.youtube.com', 'ads.linkedin.com', 'analytics.pointdrive.linkedin.com',
  
  // Search Engine Ad-Subdomains
  'ads.yahoo.com', 'gemini.yahoo.com', 'adfox.yandex.ru', 'metrika.yandex.ru',
  'appmetrica.yandex.ru', 'adfstat.yandex.ru', 'offerwall.yandex.net',
  'analytics.yahoo.com', 'analytics.query.yahoo.com', 'partnerads.ysm.yahoo.com',
  'adtech.yahooinc.com', 'mc.yandex.ru', 'an.yandex.ru',
  
  // OEM Telemetry
  'samsungads.com', 'samsunghealthcn.com', 'nmetrics.samsung.com', 'smetrics.samsung.com',
  'oneplus.cn', 'oneplus.net', 'mzstatic.com',
  'iadsdk.apple.com', 'api-adservices.apple.com', 'apple-cloudkit.com',
  'analytics-events.apple.com', 'weather-analytics-events.apple.com',
  'notes-analytics-events.apple.com', 'books-analytics-events.apple.com',
  'ad.xiaomi.com', 'mistat.xiaomi.com', 'ad.intl.xiaomi.com', 'tracking.rus.miui.com',
  'adsfs.oppomobile.com', 'adx.ads.oppomobile.com', 'ck.ads.oppomobile.com',
  'data.ads.oppomobile.com', 'logservice.hicloud.com', 'logservice1.hicloud.com',
  'logbak.hicloud.com', 'metrics.data.hicloud.com', 'metrics2.data.hicloud.com',
  'grs.hicloud.com', 'iot-logser.realme.com', 'iot-eu-logser.realme.com',
  'bdapi-ads.realmemobile.com', 'bdapi-in-ads.realmemobile.com',
  
  // Cloud Trackers
  'analytics.s3.amazonaws.com', 'analyticsengine.s3.amazonaws.com',
  'adtago.s3.amazonaws.com', 'advice-ads.s3.amazonaws.com'
]);

const FAST_PATTERNS = [
  '/ads/', '/ad-server/', '/pixels/', '/track/', '/track?', '/collect?', '/telemetry/', 
  '/analytics/', 'miner.js', 'fwtracks', 'adservices', 'analytics-events', 'pagead.js', 'ads.js',
  'flash', 'banner', 'sponsor', 'mistat', 'ad.intl', 'intercom', 'segment', 'metrika', 'mc.yandex'
];

const BLOCKED_PATTERNS_REGEX = [
  /\/ads?\//i, /\/pixels?\//i, /stats\.g\.doubleclick\.net/i, /log\.fc\.yahoo\.com/i,
  /geo\.yahoo\.com/i, /udcm\.yahoo\.com/i, /tracking\./i, /metrics\./i, /ads\.js/i,
  /pagead\.js/i, /banner/i, /sponsor/i, /flash/i, /mistat/i, /bugsnag/i
];

const HIGH_RISK_RESOURCES = new Set([
  'script', 'xhr', 'fetch', 'image', 'ping', 'subFrame', 'other', 'media', 'webSocket', 'font'
]);

const SAFE_FIRST_PARTY_TYPES = new Set([
  'mainFrame', 'stylesheet', 'image', 'font', 'media'
]);

// ─── Cosmetic Configuration ────────────────────────────────────────────────

const COSMETIC_CSS = `
  iframe[src*="doubleclick"], iframe[src*="googlesyndication"],
  iframe[src*="googleadservices"], iframe[src*="adservice"],
  iframe[src*="adnxs"], iframe[src*="taboola"], iframe[src*="outbrain"],
  iframe[src*="criteo"], iframe[src*="media.net"],
  object, embed,
  .adbox, .banner_ads, .adsbox, .textads,
  .ads-box, .ad_box, .ad-container, .ad-wrapper, .ad-placement,
  [id^="ad_"], [id^="ad-"], [id^="ads_"], [id^="ads-"],
  [class^="ad_"], [class^="ad-"], [class^="ads_"], [class^="ads-"],
  [id*="doubleclick"], [class*="doubleclick"],
  [id*="googlesyndication"], [class*="googlesyndication"],
  [id*="taboola"], [class*="taboola"],
  [id*="outbrain"], [class*="outbrain"],
  [id*="criteo"], [class*="criteo"],
  [id*="media.net"], [class*="media.net"]
  {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    width: 0 !important;
    height: 0 !important;
    max-width: 0 !important;
    max-height: 0 !important;
    overflow: hidden !important;
  }
`.trim();

const DYNAMIC_COSMETIC_SCRIPT = `(() => {
  if (window.__kiyoPrivacyObserverInstalled) return;
  window.__kiyoPrivacyObserverInstalled = true;
  const selectors = [
    'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]',
    'iframe[src*="googleadservices"]', 'iframe[src*="adservice"]',
    'iframe[src*="adnxs"]', 'iframe[src*="taboola"]', 'iframe[src*="outbrain"]',
    'iframe[src*="criteo"]', 'iframe[src*="media.net"]',
    '.adbox', '.banner_ads', '.adsbox', '.textads',
    '.ads-box', '.ad_box', '.ad-container', '.ad-wrapper', '.ad-placement',
    '[id^="ad_"]', '[id^="ad-"]', '[id^="ads_"]', '[id^="ads-"]',
    '[class^="ad_"]', '[class^="ad-"]', '[class^="ads_"]', '[class^="ads-"]'
  ].join(',');
  const removeMatches = () => {
    document.querySelectorAll(selectors).forEach((node) => {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
  };
  removeMatches();
  const observer = new MutationObserver(() => removeMatches());
  observer.observe(document.documentElement || document, { childList: true, subtree: true });
})();`;

// ─── Utility Functions ───────────────────────────────────────────────────────

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/\.+$/, '');
}

function getRootDomain(hostname) {
  const parts = normalizeHostname(hostname).split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  const commonTwoPartTLDs = new Set(['co.uk', 'com.au', 'net.au', 'org.uk', 'co.jp', 'com.br', 'co.in']);
  return commonTwoPartTLDs.has(lastTwo) ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
}

function isFirstParty(requestUrl, initiator) {
  if (!initiator) return false;
  try {
    const req = new URL(requestUrl);
    const ini = new URL(initiator);
    return getRootDomain(req.hostname) === getRootDomain(ini.hostname);
  } catch { return false; }
}

function isDomainBlocked(hostname) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return false;
  if (DOMAIN_CACHE.has(normalized)) return DOMAIN_CACHE.get(normalized);
  for (const blocked of BLOCKED_DOMAINS) {
    if (normalized === blocked || normalized.endsWith(`.${blocked}`)) {
      DOMAIN_CACHE.set(normalized, true);
      return true;
    }
  }
  DOMAIN_CACHE.set(normalized, false);
  return false;
}

function scoreSuspiciousCname(chain) {
  const joined = chain.join('.').toLowerCase();
  const needles = [
    'doubleclick', 'googleadservices', 'googlesyndication', 'adnxs', 'taboola',
    'outbrain', 'criteo', 'pubmatic', 'rubiconproject', 'analytics', 'tracking',
    'metrics', 'segment', 'mixpanel', 'hotjar', 'clarity', 'datadog', 'intercom',
    'fullstory', 'logrocket', 'bugsnag', 'sentry', 'microsoftmetrics', 'facebook'
  ];
  return needles.some((needle) => joined.includes(needle));
}

async function resolveCnameSuspicious(hostname) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return false;
  if (CNAME_CACHE.has(normalized)) return CNAME_CACHE.get(normalized);
  if (CNAME_PENDING.has(normalized)) return false;
  CNAME_PENDING.add(normalized);
  try {
    const chain = await dns.resolveCname(normalized);
    const suspicious = Array.isArray(chain) && chain.length > 0 && scoreSuspiciousCname(chain);
    CNAME_CACHE.set(normalized, suspicious);
    return suspicious;
  } catch {
    CNAME_CACHE.set(normalized, false);
    return false;
  } finally {
    CNAME_PENDING.delete(normalized);
  }
}

function warmCnameLookup(hostname) {
  const normalized = normalizeHostname(hostname);
  if (!normalized || CNAME_CACHE.has(normalized) || CNAME_PENDING.has(normalized)) return;
  void resolveCnameSuspicious(normalized);
}

// ─── Core Engine ─────────────────────────────────────────────────────────────

function setupPrivacyShield(sess, options = {}) {
  const { enableCnameHeuristic = true, enableCosmeticFiltering = true } = options;
  
  sess.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const url = details.url;
    if (url.startsWith('kiyo://') || url.startsWith('file://')) return callback({ cancel: false });
    try {
      const parsedUrl = new URL(url);
      const hostname = normalizeHostname(parsedUrl.hostname);
      const resourceType = details.resourceType;
      const initiator = details.initiator;
      if (!hostname) return callback({ cancel: false });

      if (isDomainBlocked(hostname)) {
        if (isFirstParty(url, initiator) && SAFE_FIRST_PARTY_TYPES.has(resourceType)) return callback({ cancel: false });
        return callback({ cancel: true });
      }

      if (enableCnameHeuristic && !isFirstParty(url, initiator)) {
        warmCnameLookup(hostname);
        if (CNAME_CACHE.get(hostname) === true) return callback({ cancel: true });
      }

      if (HIGH_RISK_RESOURCES.has(resourceType)) {
        if (isFirstParty(url, initiator) && SAFE_FIRST_PARTY_TYPES.has(resourceType)) return callback({ cancel: false });
        const lowerUrl = url.toLowerCase();
        if (FAST_PATTERNS.some(p => lowerUrl.includes(p)) || BLOCKED_PATTERNS_REGEX.some(re => re.test(url))) {
          return callback({ cancel: true });
        }
      }
    } catch { }
    callback({ cancel: false });
  });

  if (enableCosmeticFiltering) {
    sess.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => {
      const webContents = details.webContents;
      if (webContents) applyCosmeticFilters(webContents).catch(() => {});
    });
  }
}

async function applyCosmeticFilters(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const previousKey = COSMETIC_KEY_BY_WEBCONTENTS.get(webContents);
  if (previousKey) {
    try { await webContents.removeInsertedCSS(previousKey); } catch { }
    COSMETIC_KEY_BY_WEBCONTENTS.delete(webContents);
  }
  try {
    const key = await webContents.insertCSS(COSMETIC_CSS, { cssOrigin: 'user' });
    COSMETIC_KEY_BY_WEBCONTENTS.set(webContents, key);
    await webContents.executeJavaScript(DYNAMIC_COSMETIC_SCRIPT, true);
  } catch { }
}

function bindCosmeticFilters(webContents) {
  if (!webContents) return;
  const run = () => applyCosmeticFilters(webContents).catch(() => {});
  webContents.on('dom-ready', run);
  webContents.on('did-navigate', run);
  webContents.on('did-navigate-in-page', run);
  webContents.once('destroyed', () => { COSMETIC_KEY_BY_WEBCONTENTS.delete(webContents); });
}

module.exports = { setupPrivacyShield, applyCosmeticFilters, bindCosmeticFilters, isDomainBlocked, isFirstParty };
