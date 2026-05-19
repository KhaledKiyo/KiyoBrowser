/* history.js — Kiyo Browser history page logic */
'use strict';

lucide.createIcons({ attrs: { 'stroke-width': 2, 'class': 'lucide' } });

const historyList = document.getElementById('history-list');
const searchInput = document.getElementById('history-search');
const clearBtn = document.getElementById('clear-history');
const confirmOverlay = document.getElementById('clear-confirm-overlay');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmClear = document.getElementById('confirm-clear');

let allHistory = [];

function formatTime(ts) {
    const is24h = window._kiyoSettings?.timeFormat === '24h';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !is24h });
}

function getGroupLabel(ts) {
    const date = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function renderHistory(items) {
    if (items.length === 0) {
        historyList.innerHTML = '<div style="text-align:center; padding: 40px; color: var(--text-dim);">No history found.</div>';
        return;
    }

    const groups = {};
    items.forEach(item => {
        const label = getGroupLabel(item.visitedAt);
        if (!groups[label]) groups[label] = [];
        groups[label].push(item);
    });

    // Remove groups that no longer exist
    historyList.querySelectorAll('.history-group').forEach(g => {
        const label = g.querySelector('.group-title')?.textContent;
        if (label && !groups[label]) g.remove();
    });

    for (const [label, groupItems] of Object.entries(groups)) {
        let groupDiv = [...historyList.querySelectorAll('.history-group')]
            .find(g => g.querySelector('.group-title')?.textContent === label);

        if (!groupDiv) {
            groupDiv = document.createElement('div');
            groupDiv.className = 'history-group';
            const titleDiv = document.createElement('div');
            titleDiv.className = 'group-title';
            titleDiv.textContent = label;
            groupDiv.appendChild(titleDiv);
            historyList.appendChild(groupDiv);
        }

        groupDiv.querySelectorAll('.history-item[data-url]').forEach(el => {
            if (!groupItems.find(i => i.url === el.dataset.url)) el.remove();
        });

        groupItems.forEach(item => {
            if (groupDiv.querySelector(`.history-item[data-url="${CSS.escape(item.url)}"]`)) return;

            const itemDiv = document.createElement('div');
            itemDiv.className = 'history-item';
            itemDiv.dataset.url = item.url;
            itemDiv.onclick = e => {
                if (!e.target.closest('.delete-item')) window.electronAPI.navigate(item.url);
            };

            const timeSpan = document.createElement('span');
            timeSpan.className = 'time';
            timeSpan.textContent = formatTime(item.visitedAt);

            const faviconWrap = document.createElement('div');
            faviconWrap.className = 'favicon-wrapper';
            try {
                const urlObj = new URL(item.url);
                const img = document.createElement('img');
                img.className = 'favicon';
                img.src = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
                img.onerror = () => {
                    faviconWrap.innerHTML = '<i data-lucide="globe" class="default-icon"></i>';
                    lucide.createIcons({ nodes: [faviconWrap], attrs: { 'stroke-width': 2, 'class': 'lucide' } });
                };
                faviconWrap.appendChild(img);
            } catch {
                faviconWrap.innerHTML = '<i data-lucide="globe" class="default-icon"></i>';
            }

            const infoDiv = document.createElement('div');
            infoDiv.className = 'entry-info';
            const titleSpan = document.createElement('span');
            titleSpan.className = 'title';
            titleSpan.textContent = item.title;
            const urlSpan = document.createElement('span');
            urlSpan.className = 'url';
            urlSpan.textContent = item.url;
            infoDiv.appendChild(titleSpan);
            infoDiv.appendChild(urlSpan);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-item';
            deleteBtn.innerHTML = '<i data-lucide="x"></i>';
            deleteBtn.onclick = e => {
                e.stopPropagation();
                window.electronAPI.removeHistoryEntry(item.url);
            };

            itemDiv.appendChild(timeSpan);
            itemDiv.appendChild(faviconWrap);
            itemDiv.appendChild(infoDiv);
            itemDiv.appendChild(deleteBtn);
            groupDiv.appendChild(itemDiv);
        });
    }

    lucide.createIcons({ nodes: [historyList], attrs: { 'stroke-width': 2, 'class': 'lucide' } });
}

async function loadHistory() {
    allHistory = await window.electronAPI.getHistory();
    filterHistory();
}

function filterHistory() {
    const q = searchInput.value.toLowerCase();
    const filtered = allHistory.filter(h =>
        h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)
    );
    renderHistory(filtered);
}

searchInput.addEventListener('input', filterHistory);

clearBtn.addEventListener('click', () => {
    confirmOverlay.style.display = 'flex';
});

confirmCancel.addEventListener('click', () => {
    confirmOverlay.style.display = 'none';
});

confirmClear.addEventListener('click', () => {
    window.electronAPI.clearHistory();
    confirmOverlay.style.display = 'none';
});

window.electronAPI.onHistoryUpdated(() => {
    loadHistory();
});

loadHistory();
