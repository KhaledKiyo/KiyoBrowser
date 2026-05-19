const fs = require('fs');

function readJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { console.warn('[kiyo-utils] read failed:', filePath, e.message); }
  return fallback;
}

function writeJSON(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFile(tmpPath, JSON.stringify(data, null, 2), err => {
    if (err) {
      console.error('[kiyo-utils] write failed:', tmpPath, err.message);
      return;
    }
    fs.rename(tmpPath, filePath, err => {
      if (err) console.error('[kiyo-utils] rename failed:', filePath, err.message);
    });
  });
}

module.exports = { readJSON, writeJSON };
