// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const extGrid    = document.getElementById('ext-grid');
const btnUnpack  = document.getElementById('btn-load-unpacked');
const btnZip     = document.getElementById('btn-install-zip');
const toastEl    = document.getElementById('toast');

// ─── Toast ────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, type = 'success') {
  toastEl.textContent = msg;
  toastEl.className = `toast ${type}`;
  toastEl.style.display = 'block';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toastEl.style.display = 'none';
  }, 3200);
}

// ─── Render grid ──────────────────────────────────────────────────────────────
function renderGrid(exts) {
  extGrid.innerHTML = '';

  if (!exts || exts.length === 0) {
    extGrid.innerHTML = `
      <div class="empty-state">
        <i data-lucide="puzzle"></i>
        <h3>No extensions installed</h3>
        <p>Load an unpacked extension folder or install from a .zip file to get started.</p>
      </div>
    `;
    lucide.createIcons({ attrs: { 'stroke-width': 1.5, class: 'lucide' }, nodes: [extGrid] });
    return;
  }

  exts.forEach((ext, i) => {
    const card = document.createElement('div');
    card.className = 'ext-card';
    card.style.animationDelay = `${i * 40}ms`;

    const iconHtml = ext.iconUrl
      ? `<img class="ext-icon" src="${ext.iconUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
         <div class="ext-icon-placeholder" style="display:none;"><i data-lucide="puzzle"></i></div>`
      : `<div class="ext-icon-placeholder"><i data-lucide="puzzle"></i></div>`;

    card.innerHTML = `
      <div class="ext-card-header">
        ${iconHtml}
        <div class="ext-meta">
          <div class="ext-name" title="${escapeHtml(ext.name)}">${escapeHtml(ext.name)}</div>
          <div class="ext-version">v${escapeHtml(ext.version)}</div>
        </div>
      </div>
      ${ext.description ? `<p class="ext-description">${escapeHtml(ext.description)}</p>` : ''}
      <div class="ext-card-footer">
        <button class="btn-danger" data-id="${ext.id}" title="Remove extension">
          <i data-lucide="trash-2"></i> Remove
        </button>
      </div>
    `;

    card.querySelector('.btn-danger').addEventListener('click', async () => {
      const confirmed = confirm(`Remove "${ext.name}"?`);
      if (!confirmed) return;
      const result = await window.electronAPI.extRemove(ext.id);
      if (result.success) {
        showToast(`Removed: ${ext.name}`);
        loadExtensions();
      } else {
        showToast('Remove failed: ' + result.error, 'error');
      }
    });

    extGrid.appendChild(card);
  });

  lucide.createIcons({ attrs: { 'stroke-width': 1.5, class: 'lucide' }, nodes: [extGrid] });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Load & refresh ───────────────────────────────────────────────────────────
async function loadExtensions() {
  try {
    const exts = await window.electronAPI.extList();
    renderGrid(exts);
  } catch (e) {
    renderGrid([]);
    showToast('Failed to load extensions: ' + e.message, 'error');
  }
}

// ─── Install buttons ──────────────────────────────────────────────────────────
btnUnpack.addEventListener('click', async () => {
  const dir = await window.electronAPI.extOpenFileDialog();
  if (!dir) return;
  btnUnpack.disabled = true;
  btnUnpack.textContent = 'Installing…';
  const result = await window.electronAPI.extInstallUnpacked(dir);
  btnUnpack.disabled = false;
  btnUnpack.innerHTML = '<i data-lucide="folder-open"></i> Load Unpacked';
  lucide.createIcons({ attrs: { 'stroke-width': 1.5, class: 'lucide' }, nodes: [btnUnpack] });
  if (result.success) {
    showToast('Extension installed successfully!');
    loadExtensions();
  } else {
    showToast('Install failed: ' + result.error, 'error');
  }
});

btnZip.addEventListener('click', async () => {
  const zipPath = await window.electronAPI.extOpenZipDialog();
  if (!zipPath) return;
  btnZip.disabled = true;
  btnZip.textContent = 'Installing…';
  const result = await window.electronAPI.extInstallZip(zipPath);
  btnZip.disabled = false;
  btnZip.innerHTML = '<i data-lucide="package"></i> Install from ZIP';
  lucide.createIcons({ attrs: { 'stroke-width': 1.5, class: 'lucide' }, nodes: [btnZip] });
  if (result.success) {
    showToast('Extension installed successfully!');
    loadExtensions();
  } else {
    showToast('Install failed: ' + result.error, 'error');
  }
});

// ─── IPC push updates ─────────────────────────────────────────────────────────
window.electronAPI.onExtInstalled(() => loadExtensions());
window.electronAPI.onExtRemoved(() => loadExtensions());

// ─── Init ─────────────────────────────────────────────────────────────────────
loadExtensions();
