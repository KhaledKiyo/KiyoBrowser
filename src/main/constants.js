/**
 * constants.js — single source of truth for Kiyo Browser.
 * Required by main.js only. Renderer receives values over IPC.
 */

const { randomUUID } = require('crypto');

const PAGE_ALIASES = Object.freeze({
  HOME:      'home',
  SETTINGS:  'settings',
  DOWNLOADS: 'downloads',
  BOOKMARKS: 'bookmarks',
  HISTORY:   'history',
  NOTE:      'note',
  READER:    'reader',
  PASSWORDS: 'passwords',
  WELCOME:   'welcome',
  EXTENSIONS:'extensions',
});

const SEARCH_ENGINES = Object.freeze({
  GOOGLE:     'google',
  BING:       'bing',
  DUCKDUCKGO: 'duckduckgo',
});

const TAB_STYLES = Object.freeze({
  SQUIRCLE: 'squircle',
  SQUARE:   'square',
  CIRCLE:   'circle',
});

const MAX_DOWNLOADS_HISTORY = 50;
const MAX_TABS              = 20;
const MAX_HISTORY_ENTRIES   = 1000;
const MAX_BOOKMARKS         = 500;

/** Collision-free tab ID using crypto UUID */
function newTabId() { return randomUUID(); }

module.exports = {
  PAGE_ALIASES,
  SEARCH_ENGINES,
  TAB_STYLES,
  MAX_DOWNLOADS_HISTORY,
  MAX_TABS,
  MAX_HISTORY_ENTRIES,
  MAX_BOOKMARKS,
  newTabId,
};
