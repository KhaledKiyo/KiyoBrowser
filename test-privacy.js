const { isDomainBlocked, BLOCKED_DOMAINS, FAST_PATTERNS, BLOCKED_PATTERNS_REGEX } = require('./src/main/lib/privacy.js');
console.log("Exports loaded, testing patterns...");
// Simulate FAST_PATTERNS check
const url = "https://adblock-tester.com/banners/pr_advertising_ads_banner.gif";
const lowerUrl = url.toLowerCase();
const matches = FAST_PATTERNS.some(p => lowerUrl.includes(p));
console.log("Matches /banners/?", matches);
