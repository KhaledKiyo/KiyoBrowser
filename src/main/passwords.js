const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

class PasswordManager {
  constructor(dataDir) {
    this.filePath = path.join(dataDir, 'kiyo-passwords.enc');
    this.key = null;
  }

  async setMasterPassword(password) {
    // Generate salt for storage
    const salt = crypto.randomBytes(16);
    const key = await this._deriveKey(password, salt);
    this.key = key;

    // Encrypt empty data array to create initial file
    await this._saveToFile([], salt);
  }

  async verifyMasterPassword(password) {
    try {
      if (!(await this.isSetup())) return false;
      const fileData = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      const salt = Buffer.from(fileData.salt, 'hex');
      const key = await this._deriveKey(password, salt);
      // Attempt to decrypt to verify
      this._decrypt(fileData, key);
      return true;
    } catch (e) {
      return false;
    }
  }

  async isSetup() {
    try {
      await fs.access(this.filePath);
      return true;
    } catch {
      return false;
    }
  }

  async unlock(password) {
    try {
      if (!(await this.isSetup())) return false;
      const fileData = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      const salt = Buffer.from(fileData.salt, 'hex');
      const key = await this._deriveKey(password, salt);
      // Attempt decryption to verify
      this._decrypt(fileData, key);
      this.key = key;
      return true;
    } catch (e) {
      return false;
    }
  }

  lock() {
    this.key = null;
  }

  isUnlocked() {
    return this.key !== null;
  }

  async save(domain, username, password) {
    if (!this.isUnlocked()) throw new Error('Locked');
    const data = await this._readData();
    const existingIndex = data.findIndex(c => c.domain === domain && c.username === username);
    const cred = { domain, username, password, savedAt: Date.now() };
    if (existingIndex >= 0) {
      data[existingIndex] = cred;
    } else {
      data.push(cred);
    }
    await this._saveData(data);
  }

  async get(domain) {
    if (!this.isUnlocked()) throw new Error('Locked');
    const data = await this._readData();
    return data.filter(c => c.domain === domain).map(({ username, password, savedAt }) => ({ username, password, savedAt }));
  }

  async getAll() {
    if (!this.isUnlocked()) throw new Error('Locked');
    const data = await this._readData();
    return data.map(({ domain, username, savedAt }) => ({ domain, username, savedAt }));
  }

  async delete(domain, username) {
    if (!this.isUnlocked()) throw new Error('Locked');
    let data = await this._readData();
    data = data.filter(c => !(c.domain === domain && c.username === username));
    await this._saveData(data);
  }

  async search(query) {
    if (!this.isUnlocked()) throw new Error('Locked');
    const data = await this._readData();
    const q = query.toLowerCase();
    return data.filter(c => c.domain.toLowerCase().includes(q) || c.username.toLowerCase().includes(q))
               .map(({ domain, username, savedAt }) => ({ domain, username, savedAt }));
  }

  // --- Internal helpers ---

  _deriveKey(password, salt) {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(password, salt, 310000, 32, 'sha256', (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
  }

  async _readData() {
    const fileData = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    return JSON.parse(this._decrypt(fileData, this.key));
  }

  async _saveData(dataArray) {
    const fileData = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    const salt = Buffer.from(fileData.salt, 'hex');
    await this._saveToFile(dataArray, salt);
  }

  async _saveToFile(dataArray, salt) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const plaintext = JSON.stringify(dataArray);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    const fileData = {
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted
    };
    await fs.writeFile(this.filePath, JSON.stringify(fileData), 'utf8');
  }

  _decrypt(fileData, key) {
    const iv = Buffer.from(fileData.iv, 'hex');
    const tag = Buffer.from(fileData.tag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(fileData.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

module.exports = PasswordManager;
