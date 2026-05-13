const { session } = require('electron');
const crypto = require('crypto');

// ─── Private Session Manager ──────────────────────────────────────────────────
const PrivateSessionManager = {
  currentPartitionId: null,
  activePrivateWindows: 0,

  getPartitionId() {
    if (!this.currentPartitionId) {
      this.currentPartitionId = `incognito-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    }
    return this.currentPartitionId;
  },

  increment() { this.activePrivateWindows++; },
  decrement() {
    this.activePrivateWindows--;
    if (this.activePrivateWindows <= 0) {
      this.activePrivateWindows = 0;
      this.cleanup();
    }
  },

  async cleanup() {
    if (!this.currentPartitionId) return;
    const sess = session.fromPartition(this.currentPartitionId);
    await sess.clearStorageData();
    await sess.clearCache();
    console.log('[kiyo-session] Private session cleared:', this.currentPartitionId);
    this.currentPartitionId = null;
  }
};

module.exports = { PrivateSessionManager };
