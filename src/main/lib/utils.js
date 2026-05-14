const fs = require('fs');

function readJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { console.warn('[kiyo-utils] read failed:', filePath, e.message); }
  return fallback;
}

function writeJSON(filePath, data) {
  fs.writeFile(filePath, JSON.stringify(data, null, 2), err => {
    if (err) console.error('[kiyo-utils] write failed:', filePath, err.message);
  });
}

module.exports = { readJSON, writeJSON };
