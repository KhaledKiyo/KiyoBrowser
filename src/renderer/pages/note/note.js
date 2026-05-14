// ─── Constants ────────────────────────────────────────────────────────────────
let FOLDERS = JSON.parse(localStorage.getItem('kiyo_note_folders')) || ["Notes"];
const FOLDER_COLORS = { 
    "Notes": "#00d2ff"
};

const INITIAL_NOTES = [
    {
        id: "1", title: "Welcome to Kiyo Note", folder: "Notes",
        content: `# Welcome to Kiyo Note\n\nKiyo Note is your personal knowledge base. Dark. Fast. Yours.\n\n## Features\n\n- **Folders** — organize notes into vaults\n- **Markdown** — write in plain text, render beautifully\n- **Graph View** — see connections between ideas\n- **Search** — find anything instantly\n- **Tags** — classify with #tags\n\n## Quick Start\n\nClick any note in the sidebar to open it. Use the **+** button to create new notes.\n\nTry typing \`#idea\` or [[Notes Guide]] to explore linking.\n\n> "A place for every thought, and every thought in its place."`,
        tags: ["welcome", "kiyo"], updated: Date.now() - 3600000,
    },
    {
        id: "2", title: "Notes Guide", folder: "Notes",
        content: `# Notes Guide\n\nThis is a linked note. In the Graph View, you will see a line connecting this to [[Welcome to Kiyo Note]].\n\nLinking is the heart of Kiyo Note.`,
        tags: ["guide"], updated: Date.now() - 1800000,
    }
];

// ─── State ────────────────────────────────────────────────────────────────────
let notes = JSON.parse(localStorage.getItem('kiyo_notes')) || INITIAL_NOTES;

// Migration/Data Guard: Ensure all notes belong to an existing folder
notes = notes.map(n => {
    if (!FOLDERS.includes(n.folder)) return { ...n, folder: FOLDERS[0] };
    return n;
});

let activeId = notes.length > 0 ? notes[0].id : null;
let editing = false;
let expandedFolders = JSON.parse(localStorage.getItem('kiyo_expanded_folders')) || {};
FOLDERS.forEach(f => { if (expandedFolders[f] === undefined) expandedFolders[f] = true; });

let hoveredNodeId = null;
let inlineMode = null; // 'note', 'folder', 'rename-note', 'rename-folder'
let activeFolder = FOLDERS[0] || "Notes";
let renameTarget = null; // Stores ID or Name being renamed

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const inlineCreator = document.getElementById('inline-creator');
const inlineInput = document.getElementById('inline-input');
const confirmBtn = document.getElementById('inline-confirm');
const cancelBtn = document.getElementById('inline-cancel');
const folderList = document.getElementById('folder-list');
const searchResults = document.getElementById('search-results');
const tagsGrid = document.getElementById('tags-grid');
const searchInput = document.getElementById('note-search-input');
const editorEmpty = document.getElementById('editor-empty');
const editorContainer = document.getElementById('editor-container');
const noteTitleDisplay = document.getElementById('note-title-display');
const noteTitleInput = document.getElementById('note-title-input');
const noteFolder = document.getElementById('note-folder');
const noteUpdated = document.getElementById('note-updated');
const noteWordCount = document.getElementById('note-word-count');
const notePreview = document.getElementById('note-preview');
const noteTextarea = document.getElementById('note-textarea');
const editSaveBtn = document.getElementById('edit-save-btn');
const deleteBtn = document.getElementById('delete-note-btn');
const graphOverlay = document.getElementById('graph-view');
const graphSvg = document.getElementById('graph-svg');
const modalOverlay = document.getElementById('new-note-modal');

// ─── Initialization ───────────────────────────────────────────────────────────
function init() {
    lucide.createIcons();
    renderSidebar();
    renderNote();
    setupActivityBar();
    setupModals();
    setupSearch();
    
    // Populate folder dropdown in modal
    const folderSelect = document.getElementById('new-note-folder');
    FOLDERS.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        folderSelect.appendChild(opt);
    });
}

// ─── State Persistence ────────────────────────────────────────────────────────
function saveState() {
    localStorage.setItem('kiyo_notes', JSON.stringify(notes));
    localStorage.setItem('kiyo_expanded_folders', JSON.stringify(expandedFolders));
}

// ─── Helper Functions ────────────────────────────────────────────────────────
function timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
}

function parseMarkdown(md) {
    return md
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/^- \[x\] (.+)$/gm, '<div class="task done"><span class="cb">✓</span>$1</div>')
        .replace(/^- \[ \] (.+)$/gm, '<div class="task"><span class="cb">○</span>$1</div>')
        .replace(/^- (.+)$/gm, '<div class="li">$1</div>')
        .replace(/^\> (.+)$/gm, '<blockquote>$1</blockquote>')
        .replace(/\[\[(.+?)\]\]/g, (match, title) => {
            const target = notes.find(n => n.title === title);
            return `<span class="wikilink" onclick="openNote('${target ? target.id : ''}')">${title}</span>`;
        })
        .replace(/#(\w+)/g, '<span class="tag">#$1</span>')
        .replace(/\n{2,}/g, '</p><p>')
        .replace(/^(?!<[h123bcds])/gm, '');
}

// ─── Sidebar Rendering ───────────────────────────────────────────────────────
function renderSidebar() {
    folderList.innerHTML = '';
    const folderMap = {};
    notes.forEach(n => {
        if (!folderMap[n.folder]) folderMap[n.folder] = [];
        folderMap[n.folder].push(n);
    });

    FOLDERS.forEach(folder => {
        const fnotes = folderMap[folder] || [];
        const isExpanded = expandedFolders[folder];
        
        const folderRow = document.createElement('div');
        folderRow.className = 'folder-row';
        folderRow.innerHTML = `
            <span class="folder-arrow ${isExpanded ? 'expanded' : ''}">▶</span>
            <div class="folder-dot" style="background: ${FOLDER_COLORS[folder] || '#848d97'}"></div>
            <span class="folder-name">${folder}</span>
            <span class="note-count">${fnotes.length}</span>
        `;
        folderRow.onclick = () => {
            expandedFolders[folder] = !expandedFolders[folder];
            saveState();
            renderSidebar();
        };
        folderRow.oncontextmenu = (e) => {
            e.preventDefault();
            activeFolder = folder;
            window.electronAPI.showFolderMenu(folder);
        };
        folderList.appendChild(folderRow);

        if (isExpanded) {
            fnotes.forEach(note => {
                const noteItem = document.createElement('div');
                noteItem.className = `note-item ${activeId === note.id ? 'active' : ''}`;
                noteItem.innerHTML = `
                    <div class="note-item-title">${note.title}</div>
                    <div class="note-item-date">${timeAgo(note.updated)}</div>
                `;
                noteItem.onclick = () => openNote(note.id);
                noteItem.oncontextmenu = (e) => {
                    e.preventDefault();
                    activeId = note.id;
                    window.electronAPI.showNoteMenu(note.id);
                };
                folderList.appendChild(noteItem);
            });
        }
    });

    // Render Tags Grid
    tagsGrid.innerHTML = '';
    const allTags = [...new Set(notes.flatMap(n => n.tags))];
    allTags.forEach(tag => {
        const chip = document.createElement('div');
        chip.className = 'tag-chip';
        chip.textContent = `#${tag}`;
        chip.onclick = () => {
            switchToTab('search');
            searchInput.value = `#${tag}`;
            performSearch();
        };
        tagsGrid.appendChild(chip);
    });
    
    lucide.createIcons({ nodes: [folderList, tagsGrid] });
}

// ─── Note Rendering ──────────────────────────────────────────────────────────
function openNote(id) {
    if (!id) return;
    if (editing) toggleEdit(); // Save current work
    activeId = id;
    renderSidebar();
    renderNote();
}

function renderNote() {
    const active = notes.find(n => n.id === activeId);
    if (!active) {
        editorEmpty.style.display = 'flex';
        editorContainer.style.display = 'none';
        return;
    }

    editorEmpty.style.display = 'none';
    editorContainer.style.display = 'flex';
    
    noteTitleDisplay.textContent = active.title;
    noteFolder.textContent = active.folder;
    noteUpdated.textContent = timeAgo(active.updated);
    noteWordCount.textContent = `${active.content.split(/\s+/).length} words`;
    
    if (!editing) {
        notePreview.innerHTML = parseMarkdown(active.content);
        notePreview.style.display = 'block';
        noteTextarea.style.display = 'none';
        noteTitleDisplay.style.display = 'block';
        noteTitleInput.style.display = 'none';
        editSaveBtn.textContent = '✏ Edit';
        editSaveBtn.classList.remove('primary');
    } else {
        noteTextarea.value = active.content;
        noteTitleInput.value = active.title;
        notePreview.style.display = 'none';
        noteTextarea.style.display = 'block';
        noteTitleDisplay.style.display = 'none';
        noteTitleInput.style.display = 'block';
        editSaveBtn.textContent = 'Save';
        editSaveBtn.classList.add('primary');
    }
}

function toggleEdit() {
    const active = notes.find(n => n.id === activeId);
    if (!active) return;

    if (editing) {
        // Save
        active.content = noteTextarea.value;
        active.title = noteTitleInput.value;
        active.updated = Date.now();
        active.tags = Array.from(active.content.matchAll(/#(\w+)/g)).map(m => m[1]);
        saveState();
        editing = false;
        renderNote();
        renderSidebar();
    } else {
        editing = true;
        renderNote();
        noteTextarea.focus();
    }
}

editSaveBtn.onclick = toggleEdit;

deleteBtn.onclick = () => {
    if (!confirm('Are you sure you want to delete this note?')) return;
    notes = notes.filter(n => n.id !== activeId);
    activeId = notes.length > 0 ? notes[0].id : null;
    saveState();
    renderSidebar();
    renderNote();
};

// ─── Search ──────────────────────────────────────────────────────────────────
function setupSearch() {
    searchInput.oninput = performSearch;
}

function performSearch() {
    const q = searchInput.value.toLowerCase();
    searchResults.innerHTML = '';
    
    const filtered = notes.filter(n => 
        n.title.toLowerCase().includes(q) || 
        n.content.toLowerCase().includes(q)
    );

    filtered.forEach(n => {
        const item = document.createElement('div');
        item.className = 'note-item';
        item.innerHTML = `
            <div class="note-item-title">${n.title}</div>
            <div class="note-item-date">${n.content.replace(/[#*\[\]]/g, '').slice(0, 50)}...</div>
        `;
        item.onclick = () => {
            openNote(n.id);
            switchToTab('files');
        };
        searchResults.appendChild(item);
    });
}

// ─── Activity Bar & Tabs ─────────────────────────────────────────────────────
function setupActivityBar() {
    document.querySelectorAll('.activity-btn[data-tab]').forEach(btn => {
        btn.onclick = () => switchToTab(btn.dataset.tab);
    });

    document.getElementById('graph-toggle').onclick = toggleGraph;
}

function switchToTab(tabId) {
    document.querySelectorAll('.activity-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `pane-${tabId}`));
}

// ─── Graph View ──────────────────────────────────────────────────────────────
let graphNodes = [];
let graphEdges = [];
let graphAnimFrame;

function toggleGraph() {
    if (graphOverlay.style.display === 'none') {
        graphOverlay.style.display = 'flex';
        initGraph();
    } else {
        graphOverlay.style.display = 'none';
        cancelAnimationFrame(graphAnimFrame);
    }
}

document.getElementById('close-graph-btn').onclick = toggleGraph;

function initGraph() {
    const w = 800, h = 600;
    graphNodes = notes.map(n => ({
        id: n.id, title: n.title, folder: n.folder,
        x: w/2 + (Math.random()-0.5)*400,
        y: h/2 + (Math.random()-0.5)*400,
        vx: 0, vy: 0, r: 7 + (n.tags || []).length * 2
    }));

    graphEdges = [];
    notes.forEach(n => {
        const matches = n.content.match(/\[\[(.+?)\]\]/g) || [];
        matches.forEach(m => {
            const targetTitle = m.slice(2, -2).trim().toLowerCase();
            const target = notes.find(x => x.title.trim().toLowerCase() === targetTitle);
            if (target && target.id !== n.id) {
                // Prevent duplicate edges
                if (!graphEdges.some(e => (e.from === n.id && e.to === target.id) || (e.from === target.id && e.to === n.id))) {
                    graphEdges.push({ from: n.id, to: target.id });
                }
            }
        });
    });

    // Legend
    const legend = document.getElementById('graph-legend');
    legend.innerHTML = '';
    Object.entries(FOLDER_COLORS).forEach(([f, c]) => {
        legend.innerHTML += `<div class="legend-item"><div class="legend-dot" style="background:${c}"></div>${f}</div>`;
    });

    tickGraph();
}

function tickGraph() {
    const w = 800, h = 600;
    
    // Repulsion
    for (let i = 0; i < graphNodes.length; i++) {
        for (let j = i + 1; j < graphNodes.length; j++) {
            const dx = graphNodes[j].x - graphNodes[i].x;
            const dy = graphNodes[j].y - graphNodes[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = Math.min(3000 / (dist * dist), 3);
            graphNodes[i].vx -= (dx / dist) * force;
            graphNodes[i].vy -= (dy / dist) * force;
            graphNodes[j].vx += (dx / dist) * force;
            graphNodes[j].vy += (dy / dist) * force;
        }
    }

    // Attraction (Edges)
    graphEdges.forEach(e => {
        const a = graphNodes.find(n => n.id === e.from);
        const b = graphNodes.find(n => n.id === e.to);
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 120) * 0.01;
        a.vx += (dx / dist) * force; a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force; b.vy -= (dy / dist) * force;
    });

    // Center gravity & damping
    graphNodes.forEach(n => {
        n.vx += (w / 2 - n.x) * 0.002;
        n.vy += (h / 2 - n.y) * 0.002;
        n.vx *= 0.85; n.vy *= 0.85;
        n.x += n.vx; n.y += n.vy;
    });

    renderGraph();
    graphAnimFrame = requestAnimationFrame(tickGraph);
}

function renderGraph() {
    let html = '';
    // Draw edges first (underneath)
    graphEdges.forEach(e => {
        const a = graphNodes.find(n => n.id === e.from);
        const b = graphNodes.find(n => n.id === e.to);
        if (a && b) {
            const isRelevant = hoveredNodeId === a.id || hoveredNodeId === b.id;
            html += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" 
                      stroke="rgba(0, 210, 255, ${isRelevant ? 0.8 : 0.2})" 
                      stroke-width="${isRelevant ? 2 : 1}" 
                      stroke-linecap="round" />`;
        }
    });
    // Draw nodes
    graphNodes.forEach(n => {
        const col = FOLDER_COLORS[n.folder] || '#848d97';
        const isHov = hoveredNodeId === n.id;
        html += `
            <g class="graph-node" onclick="openNote('${n.id}'); toggleGraph();" 
               onmouseenter="hoveredNodeId = '${n.id}'" onmouseleave="hoveredNodeId = null"
               style="cursor: pointer">
                ${isHov ? `<circle cx="${n.x}" cy="${n.y}" r="${n.r + 8}" fill="${col}" opacity="0.15" />` : ''}
                <circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${col}" opacity="${isHov ? 1 : 0.7}" />
                ${isHov ? `<text x="${n.x}" y="${n.y - n.r - 8}" text-anchor="middle" fill="#e6edf3" font-size="11" font-weight="500">${n.title}</text>` : ''}
            </g>
        `;
    });
    graphSvg.innerHTML = html;
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────
function showInline(mode, target = null) {
    inlineMode = mode;
    renameTarget = target;
    inlineCreator.style.display = 'flex';
    
    if (mode === 'note') inlineInput.placeholder = 'Note title...';
    else if (mode === 'folder') inlineInput.placeholder = 'Folder name...';
    else if (mode === 'rename-folder') inlineInput.placeholder = `Rename ${target}...`;
    else if (mode === 'rename-note') {
        const n = notes.find(x => x.id === target);
        inlineInput.placeholder = `Rename ${n?.title}...`;
    }

    inlineInput.value = '';
    inlineInput.focus();
}

function hideInline() {
    inlineCreator.style.display = 'none';
    inlineMode = null;
    renameTarget = null;
}

// ─── Modals (Now Inline) ─────────────────────────────────────────────────────
function setupModals() {
    document.getElementById('new-note-trigger').onclick = () => showInline('note');
    document.getElementById('new-folder-trigger').onclick = () => showInline('folder');
    
    cancelBtn.onclick = hideInline;
    
    confirmBtn.onclick = () => {
        const val = inlineInput.value.trim();
        if (inlineMode === 'note') createNote(val);
        else if (inlineMode === 'folder') createFolder(val);
        else if (inlineMode === 'rename-folder') renameFolder(renameTarget, val);
        else if (inlineMode === 'rename-note') renameNote(renameTarget, val);
        hideInline();
    };

    inlineInput.onkeydown = (e) => {
        const val = inlineInput.value.trim();
        if (e.key === 'Enter') {
            if (inlineMode === 'note') createNote(val);
            else if (inlineMode === 'folder') createFolder(val);
            else if (inlineMode === 'rename-folder') renameFolder(renameTarget, val);
            else if (inlineMode === 'rename-note') renameNote(renameTarget, val);
            hideInline();
        } else if (e.key === 'Escape') {
            hideInline();
        }
    };
    
    // Download button
    document.getElementById('download-note-btn').onclick = downloadNote;
}

function renameFolder(oldName, newName) {
    if (!newName || FOLDERS.includes(newName)) return;
    FOLDERS = FOLDERS.map(f => f === oldName ? newName : f);
    notes.forEach(n => { if (n.folder === oldName) n.folder = newName; });
    FOLDER_COLORS[newName] = FOLDER_COLORS[oldName];
    delete FOLDER_COLORS[oldName];
    if (activeFolder === oldName) activeFolder = newName;
    localStorage.setItem('kiyo_note_folders', JSON.stringify(FOLDERS));
    saveState();
    renderSidebar();
}

function deleteFolder(name) {
    if (!confirm(`Are you sure you want to delete "${name}"? All notes inside will move to "${FOLDERS[0] === name ? (FOLDERS[1] || 'General') : FOLDERS[0]}".`)) return;
    
    const fallback = FOLDERS.find(f => f !== name) || "General";
    if (!FOLDERS.includes(fallback)) FOLDERS.push(fallback);

    FOLDERS = FOLDERS.filter(f => f !== name);
    notes.forEach(n => { if (n.folder === name) n.folder = fallback; });
    
    localStorage.setItem('kiyo_note_folders', JSON.stringify(FOLDERS));
    saveState();
    renderSidebar();
}

function renameNote(id, newTitle) {
    const note = notes.find(n => n.id === id);
    if (note && newTitle) {
        note.title = newTitle;
        saveState();
        renderSidebar();
        if (activeId === id) renderNote();
    }
}

function createFolder(name) {
    if (!name || FOLDERS.includes(name)) return;

    FOLDERS.push(name);
    if (!FOLDER_COLORS[name]) {
        const hue = Math.floor(Math.random() * 360);
        FOLDER_COLORS[name] = `hsl(${hue}, 80%, 60%)`;
    }
    
    localStorage.setItem('kiyo_note_folders', JSON.stringify(FOLDERS));
    expandedFolders[name] = true;
    saveState();
    renderSidebar();
}

function createNote(title, folder = null) {
    if (!title) return;
    
    const targetFolder = folder || activeFolder || FOLDERS[0] || "Notes";

    const note = {
        id: Date.now().toString(),
        title,
        folder: targetFolder,
        content: `# ${title}\n\n`,
        tags: [],
        updated: Date.now()
    };

    notes.unshift(note);
    saveState();
    openNote(note.id);
    toggleEdit();
}

function downloadNote() {
    const active = notes.find(n => n.id === activeId);
    if (!active) return;
    
    const blob = new Blob([active.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
}

// ─── Start ────────────────────────────────────────────────────────────────────
// Handle Native Context Menu Actions
if (window.electronAPI && window.electronAPI.onNoteAction) {
    window.electronAPI.onNoteAction((action) => {
        console.log('[kiyo-note] Action received:', action);
        switch (action.type) {
            case 'new-note':
                createNote(`Untitled in ${action.folder}`, action.folder);
                break;
            case 'rename-folder':
                showInline('rename-folder', action.folder);
                break;
            case 'delete-folder':
                deleteFolder(action.folder);
                break;
            case 'rename-note':
                showInline('rename-note', action.id);
                break;
            case 'delete-note':
                if (confirm('Delete this note?')) {
                    notes = notes.filter(n => n.id !== action.id);
                    if (activeId === action.id) activeId = notes[0]?.id || null;
                    saveState();
                    renderSidebar();
                    renderNote();
                }
                break;
        }
    });
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();

// Right-Click Context Menu (General)
window.addEventListener('contextmenu', (e) => {
    // Only show general menu if we didn't right-click a folder or note
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (window.electronAPI) window.electronAPI.showContextMenu();
});

// Force Focus Fix: Grab keyboard focus on click
window.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        e.target.focus();
    }
});
