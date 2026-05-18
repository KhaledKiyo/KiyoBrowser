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
  'adtago.s3.amazonaws.com', 'advice-ads.s3.amazonaws.com',

  // Programmatic / Header Bidding
  'prebid.org', 'prebid.io', 'ib.adnxs.com', 'secure.adnxs.com',
  'cdn.ampproject.org', 'pagead2.googlesyndication.com',
  'tpc.googlesyndication.com', 'partner.googleadservices.com',
  'bid.g.doubleclick.net', 'cm.g.doubleclick.net',
  'securepubads.g.doubleclick.net', 'www3.doubleclick.net',

  // Data Brokers / Identity Resolution
  'liveramp.com', 'liveramp.net', 'rlcdn.com', 'acuityads.com',
  'lotame.com', 'bluekai.com', 'kruxdigital.com', 'data.crwdcntrl.net',
  'semasio.net', 'weborama.com', 'weborama.net',

  // Affiliate / Conversion Tracking
  'shareasale.com', 'clickbank.net', 'tradedoubler.com', 'awin1.com',
  'pepperjamnetwork.com', 'impactradius.com', 'evyy.net', 'jdoqocy.com',
  'tkqlhce.com', 'dpbolvw.net', 'kqzyfj.com', 'lduhtrp.com', 'anrdoezrs.net',
  'emjcd.com', 'afcyhf.com', 'qksrv.net', 'awltovhc.com',

  // Session Replay / Heatmaps
  'recording.hubspot.com', 'bat.bing.com', 'c.clarity.ms',
  'cdn.heapanalytics.com', 'heapanalytics.com', 'heap.io',
  'cdn.inspectlet.com', 'inspectlet.com', 'cdn.cquotient.com',
  'smartlook.com', 'cdn.smartlook.com', 'uxf.userreplay.net',

  // Push Notification Ad Networks
  'onesignal.com', 'pushcrew.com', 'pushwoosh.com', 'pushbots.com',
  'gravitec.net', 'pushassist.com', 'izooto.com', 'aimtell.com',
  'subscribers.com', 'sendpulse.com', 'cleverpush.com',

  // Additional Telemetry
  'app.adjust.com', 'app.appsflyer.com', 'branch.io', 'app.link',
  'bnc.lt', 'kochava.com', 'singular.net', 'tenjin.io',
  'moatads.com', 'moat.com', 'doubleverify.com', 'ias.com',
  'integralads.com', 'brandmetrics.com', 'comscore.com',
  'voicefive.com', 'chartbeat.com', 'chartbeat.net', 'parsely.com',
  'cdn.parsely.com', 'pixel.quantserve.com', 'edge.quantserve.com',

  // Ad-Blocker Test Suite (Accessible Domains)
  'aan.amazon.com', 'mgid.com', 'bingads.microsoft.com', 'ads.microsoft.com',
  'propellerads.com', 'applovin.com', 'vungle.com', 'liftoff.io',
  'indexexchange.com', 'chartboost.com', 'supersonicads.com', 'fyber.com',
  'inmobi.com', 'outcome-ssp.supersonicads.com',
  'adsrvr.org',
  'smartyads.com', 'ad.gt', 'contextweb.com', 'sharethrough.com',
  '3lift.com', 'sonobi.com', 'gumgum.com', 'teads.tv', 'kargo.com',
  'adroll.com', 'pangleglobal.com', 'adsafeprotected.com', 'insightexpressai.com',
  'tagmanager.google.com', 'analytics.adobe.io', 'quantcast.com',
  'fingerprintjs.com', 'fpjs.io', 'siftscience.com', 'permutive.com',
  'onetag-sys.com', 'pippio.com', 'id5-sync.com', 'mathtag.com',
  'tapad.com', 'uidapi.com', 'appsflyer.com', 'adjust.com', 'wzrkt.com',
  'clevertap-prod.com', 'coinimp.com', 'crypto-loot.org', 'monerominer.rocks',
  'popcash.net', 'onclickads.net', 'clickadu.com', 'trafficjunky.net',
  'exoclick.com', 'juicyads.com', '2giga.link', 'greatis.com', 'statdynamic.com',
  'graph.facebook.com', 'tr.facebook.com', 'graph.instagram.com', 'i.instagram.com',
  'sc-static.net', 'tr.snapchat.com', 'sc-analytics.appspot.com', 'snap.licdn.com',
  'ads-api.x.com', 'analytics.twitter.com', 'ads.x.com', 'd.reddit.com',
  'ct.pinterest.com', 'pixel.quora.com', 'px.srvcs.tumblr.com',
  'ads.vk.com', 'ad.mail.ru', 'top-fwz1.mail.ru',
  'xp.apple.com', 'ads.huawei.com', 'us.info.lgsmartad.com', 'smartclip.net',
  'smartclip.com', 'vortex.data.microsoft.com', 'device-metrics-us.amazon.com',
  'device-metrics-us-2.amazon.com', 'mads-eu.amazon.com', 'ads.roku.com',
  'app-measurement.com', 'firebase-settings.crashlytics.com',
  'cookielaw.org', 'onetrust.com', 'cookiebot.com', 'trustarc.com',
  'privacy-center.org', 'privacy-mgmt.com', 'usercentrics.eu',
  'shareasale-analytics.com', 'linksynergy.com', 'impact.com',
  'impactradius-event.com', 'partnerstack.com', 'refersion.com',
  'skimresources.com', 'viglink.com', 'optimizely.com', 'dynamicyield.com',
  'track.hubspot.com', 'trackcmp.net', 'driftt.com',
  'imasdk.googleapis.com', 'dai.google.com', 'jwpsrv.com', 'jwpcdn.com',
  'fwmrm.net', 'connatix.com', 'innovid.com', 'tremorhub.com',

  // Last batch of missing domains
  'mineralt.io', 'cdn.segment.com', 'ironsource.mobi', 'zenaps.com', 'is.com', 'popads.net',

  // Adblock test suite — Yahoo/Xiaomi telemetry subdomains
  'log.fc.yahoo.com', 'udcm.yahoo.com',
  'data.mistat.india.xiaomi.com', 'data.mistat.rus.xiaomi.com',
  'data.mistat.xiaomi.com',
]);

const FAST_PATTERNS = [
  '/ads/', '/ad-server/', '/pixels/', '/pixel/', '/track/', '/track?',
  '/collect?', '/collect/', '/telemetry/', '/analytics/', '/beacon/',
  '/event/', '/events?', '/impression/', '/conversion/', '/retarget/',
  '/remarketing/', '/affiliate/', '/click?', '/click/', '/ping?',
  'miner.js', 'fwtracks', 'adservices', 'analytics-events',
  'pagead.js', 'ads.js', 'ad.js', 'adframe.js', 'admanager.js',
  'prebid.js', 'gpt.js', 'googletag', 'banner', 'sponsor',
  'mistat', 'ad.intl', 'intercom', '/segment.js', 'api.segment.io',
  'metrika', 'mc.yandex', '/gtag/js', '/gtm.js', '/fbq/', 'fbevents.js',
  'clarity.js', '/hotjar-', 'mouseflow.js', 'fullstory.js',
  '/tr?id=', '/tr/?', 'ttq.min.js', 'tiktok-pixel', 'vk.com/rtrg',
  '/banner.', '/banners/', '/ad.', '/ads.', '/advert.', '/promo.',
  'analytics.js', 'sentry.js', 'sentry.min.js', 'bundle.tracing.min.js'
];

const BLOCKED_PATTERNS_REGEX = [
  /\/ads?\//i, /\/pixels?\//i, /stats\.g\.doubleclick\.net/i,
  /log\.fc\.yahoo\.com/i, /geo\.yahoo\.com/i, /udcm\.yahoo\.com/i,
  /tracking\./i, /metrics\./i, /ads\.js/i, /pagead\.js/i,
  /banner/i, /sponsor/i, /mistat/i, /bugsnag/i,
  /\/beacon\//i, /\/collect\//i, /\/impression\//i,
  /\/conversion\//i, /\/retarget/i, /prebid/i,
  /googletag/i, /fbevents/i, /clarity\.js/i,
  /hotjar/i, /mouseflow/i, /fullstory/i,
  /[?&]utm_/i, /[?&]fbclid=/i, /[?&]gclid=/i,
  /[?&]ttclid=/i, /[?&]msclkid=/i,
  /\/banner(?:s)?\.(?:gif|jpg|jpeg|png|swf|webp)/i,
  /\/ads?\.(?:gif|jpg|jpeg|png|swf|webp)/i,
  /\/advert\.(?:gif|jpg|jpeg|png|swf|webp)/i,
  /sentry\.(?:min\.)?js/i, /analytics\.(?:min\.)?js/i,
  /\/bundle\.tracing\.(?:min\.)?js/i
];

const HIGH_RISK_RESOURCES = new Set([
  // 'media' intentionally excluded — blocking it kills YouTube/Twitch video streams
  // because internal YouTube URLs can contain '/ads/' as part of ad-skip signalling.
  'script', 'xhr', 'fetch', 'image', 'ping', 'subFrame', 'other', 'webSocket', 'font', 'object'
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
  [id*="media.net"], [class*="media.net"],
  [id*="sponsor"], [class*="sponsor"],
  [id*="promoted"], [class*="promoted"],
  [id*="advertisement"], [class*="advertisement"],
  [id*="adsense"], [class*="adsense"],
  [id*="adslot"], [class*="adslot"],
  [id*="adunit"], [class*="adunit"],
  div[data-ad], div[data-ads], div[data-adunit],
  ins.adsbygoogle,
  .widget_affiliateads, .wp_ad_camp_widget,
  .adsbygoogle, .adsbygoogle-noablate,
  [data-google-query-id], [data-ad-client]
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
    '.sponsored-post', '.promoted-tweet',
    'ins.adsbygoogle', '[data-ad-client]',
    '.adsbygoogle', 'ytd-ad-slot-renderer', 'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-video-renderer'
  ].join(',');
  const removeMatches = () => {
    document.querySelectorAll(selectors).forEach((node) => {
      if (node && node.style && node.style.display !== 'none') {
        node.style.setProperty('display', 'none', 'important');
      }
    });
    
    // Force spellcheck to be enabled on all inputs (bypasses Google's spellcheck="false")
    document.querySelectorAll('textarea, input[type="text"], input[type="search"], [contenteditable]').forEach(el => {
      if (el.getAttribute('spellcheck') === 'false') {
        el.setAttribute('spellcheck', 'true');
      }
    });
  };
  removeMatches();
  let _kiyoTimer = null;
  const observer = new MutationObserver(() => {
    if (_kiyoTimer) return;
    _kiyoTimer = setTimeout(() => { _kiyoTimer = null; removeMatches(); }, 250);
  });
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
    const req = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl;
    const ini = typeof initiator === 'string' ? new URL(initiator) : initiator;
    return getRootDomain(req.hostname) === getRootDomain(ini.hostname);
  } catch { return false; }
}

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
  'msclkid', 'ttclid', 'twclid', 'li_fat_id', 'igshid',
  'mc_eid', 'ml_subscriber', 'ml_subscriber_hash',
  '_ga', '_gl', 'yclid', 'wickedid', 'ScCid',
  'zanpid', 'ref', 'affiliate', 'affid', 'aff_id',
]);

function stripTrackingParams(url) {
  if (!url.includes('?')) return null;
  try {
    const u = new URL(url);
    let stripped = false;
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key) || key.startsWith('utm_')) {
        u.searchParams.delete(key);
        stripped = true;
      }
    }
    return stripped ? u.toString() : null; // null = no change needed
  } catch { return null; }
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

    // Strip tracking parameters before any other check
    const cleanUrl = stripTrackingParams(url);
    if (cleanUrl) return callback({ redirectURL: cleanUrl });
    try {
      const parsedUrl = new URL(url);
      const hostname = normalizeHostname(parsedUrl.hostname);
      const resourceType = details.resourceType;
      const initiator = details.initiator;
      if (!hostname) return callback({ cancel: false });

      if (isDomainBlocked(hostname)) {
        if (isFirstParty(parsedUrl, initiator) && SAFE_FIRST_PARTY_TYPES.has(resourceType)) return callback({ cancel: false });
        console.log('[SHIELD] Blocked domain:', hostname, 'URL:', url);
        return callback({ cancel: true });
      }

      if (enableCnameHeuristic && !isFirstParty(parsedUrl, initiator)) {
        warmCnameLookup(hostname);
        if (CNAME_CACHE.get(hostname) === true) {
          console.log('[SHIELD] Blocked CNAME:', hostname, 'URL:', url);
          return callback({ cancel: true });
        }
      }

      if (HIGH_RISK_RESOURCES.has(resourceType)) {
        // Never pattern-block first-party requests from trusted media sites
        // (YouTube internal URLs can contain '/ads/' in ad-skipping signal paths)
        const isYouTube = hostname.endsWith('youtube.com') || hostname.endsWith('youtu.be')
          || hostname.endsWith('googlevideo.com') || hostname.endsWith('ytimg.com')
          || hostname.endsWith('ggpht.com');
        if (!isYouTube || !isFirstParty(parsedUrl, initiator)) {
          const lowerUrl = url.toLowerCase();
          if (FAST_PATTERNS.some(p => lowerUrl.includes(p)) || BLOCKED_PATTERNS_REGEX.some(re => re.test(url))) {
            console.log('[SHIELD] Blocked pattern:', 'URL:', url);
            return callback({ cancel: true });
          }
        }
      }
    } catch (e) {
      console.error('[SHIELD] Error evaluating URL:', url, e.message);
    }
    callback({ cancel: false });
  });

}

async function applyCosmeticFilters(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const currentUrl = webContents.getURL() || '';
  if (currentUrl.includes('youtube.com') || currentUrl.includes('youtu.be')) {
    return; // Bypass completely for YouTube, let the native adblocker handle it
  }

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
  const run = () => applyCosmeticFilters(webContents).catch(() => { });
  webContents.on('dom-ready', run);
  webContents.on('did-navigate', run);
  webContents.on('did-navigate-in-page', run);
  webContents.once('destroyed', () => { COSMETIC_KEY_BY_WEBCONTENTS.delete(webContents); });
}

module.exports = { setupPrivacyShield, applyCosmeticFilters, bindCosmeticFilters, isDomainBlocked, isFirstParty };
