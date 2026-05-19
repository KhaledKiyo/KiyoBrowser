/* downloads.js — Kiyo Browser downloads page logic */
'use strict';

lucide.createIcons();

const grid = document.getElementById('downloads-grid');
const emptyMsg = document.getElementById('empty-msg');

function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return 'film';
    if (['mp3', 'flac', 'wav', 'ogg', 'aac'].includes(ext)) return 'music';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
    if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return 'archive';
    if (['pdf'].includes(ext)) return 'file-text';
    if (['exe', 'dmg', 'pkg', 'deb', 'rpm', 'appimage'].includes(ext)) return 'package';
    return 'file';
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function createDownloadCard(name, progress, state) {
    emptyMsg.style.display = 'none';
    // Remove existing card for same file if re-downloading
    const existing = document.getElementById(`dl-${CSS.escape(name)}`);
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.className = `download-card ${state === 'completed' ? 'completed' : ''}`;
    card.id = `dl-${CSS.escape(name)}`;

    const pct = Math.round(progress * 100);
    const icon = getFileIcon(name);

    const iconContainer = document.createElement('div');
    iconContainer.className = 'file-icon';
    const iconEl = document.createElement('i');
    iconEl.setAttribute('data-lucide', icon);
    iconContainer.appendChild(iconEl);
    card.appendChild(iconContainer);

    const info = document.createElement('div');
    info.className = 'file-info';

    const fileName = document.createElement('div');
    fileName.className = 'file-name';
    fileName.textContent = name;
    info.appendChild(fileName);

    const fileMeta = document.createElement('div');
    fileMeta.className = 'file-meta';
    const is24h = window._kiyoSettings?.timeFormat === '24h';
    fileMeta.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !is24h });
    info.appendChild(fileMeta);

    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressBar.style.width = `${pct}%`;
    progressContainer.appendChild(progressBar);
    info.appendChild(progressContainer);

    const status = document.createElement('div');
    status.className = `status ${state === 'completed' ? 'status-done' : ''}`;
    status.textContent = state === 'completed' ? '✓ Completed'
        : state === 'cancelled' ? '✗ Cancelled'
        : pct + '%';
    info.appendChild(status);

    card.appendChild(info);

    grid.prepend(card);
    lucide.createIcons({ nodes: [card] });
}

function updateCard(name, progress, state) {
    const card = document.getElementById(`dl-${CSS.escape(name)}`);
    if (card) {
        if (state === 'completed' || state === 'cancelled') card.classList.add('completed');
        const bar = card.querySelector('.progress-bar');
        if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
        const status = card.querySelector('.status');
        if (status) {
            status.textContent = state === 'completed' ? '✓ Completed'
                : state === 'cancelled' ? '✗ Cancelled'
                : Math.round(progress * 100) + '%';
            if (state === 'completed' || state === 'cancelled') {
                status.classList.add('status-done');
                card.classList.add('completed');
            }
        }
    } else {
        createDownloadCard(name, progress, state);
    }
}

// Load existing downloads on page open
window.electronAPI.getDownloads().then(downloads => {
    if (downloads.length > 0) {
        emptyMsg.style.display = 'none';
        downloads.forEach(dl => createDownloadCard(dl.name, dl.progress, dl.state));
    }
});

// Fix: onDownloadsUpdated is the correct event (onDownloadStarted does not exist)
window.electronAPI.onDownloadsUpdated(downloads => {
    // Re-render any new in-progress items not yet shown
    downloads.forEach(dl => {
        if (!document.getElementById(`dl-${CSS.escape(dl.name)}`)) {
            createDownloadCard(dl.name, dl.progress || 0, dl.state);
        }
    });
});

window.electronAPI.onDownloadProgress((name, progress) => {
    updateCard(name, progress, 'progressing');
});

window.electronAPI.onDownloadCompleted((name, state) => {
    updateCard(name, 1, state);
});

window.electronAPI.onDownloadsCleared(() => {
    grid.innerHTML = '';
    grid.appendChild(emptyMsg);
    emptyMsg.style.display = '';
});

document.getElementById('clear-all').addEventListener('click', () => {
    window.electronAPI.clearDownloads();
});
