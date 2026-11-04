// Seitenleiste (Bild 1): Tabs „Repos / Docs / Suche“, „Repository hinzufügen“, Repo-Kopf mit „…“-Menü, Dateibaum.
import { h, frag, basename, dirname, debounce, timeAgo, copyText, download, formatBytes, escapeHtml } from '../core/util.js';
import { icon, fileIcon } from '../core/icons.js';
import { app } from '../core/store.js';
import { kv } from '../core/db.js';
import {
  state as P, getFiles, filesSync, buildTree, sortedChildren, createFile, createFolder, deletePath, renamePath, duplicatePath,
  setDisplay, removeProject, renameProject, isModified, isNew, isIndexed, switchBranch, createBranch, deleteBranch, getProject, moveProject,
} from '../projects/projects.js';
import { listBranches, cancelSync, syncBranch, isSyncing, pushChanges } from '../projects/github.js';
import { zipProject, writeBackFolder, importFiles } from '../projects/folder.js';
import { getSession, startSession, stopSession } from '../collab/session.js';
import { openFile } from '../editor/editor.js';
import { showMenu, closeMenus } from './menu.js';
import { prompt, confirm, toast } from './dialog.js';
import { renderDocsPanel } from '../docs/view.js';
import { addRepositoryMenu } from './actions.js';

let el, body, panels = {}, currentPanel = 'repos', docsApi, searchApi;
const expanded = new Map(); // projectId → Set(paths)
let selected = null; // {projectId, path}

export function initSidebar(container) {
  el = container;
  const tabs = h('div', { class: 'side-tabs' },
    tabBtn('repos', icon.book, 'Repos'),
    tabBtn('docs', icon.docs, 'Docs'),
    h('span', { class: 'side-divider' }),
    h('button', { class: 'icon-btn side-search-btn', dataset: { panel: 'search' }, title: 'In Dateien suchen', onclick: () => showPanel('search') }, frag(icon.sparkSearch)),
  );
  panels.repos = h('section', { class: 'side-panel', dataset: { panel: 'repos' } });
  panels.docs = h('section', { class: 'side-panel', dataset: { panel: 'docs' } });
  panels.search = h('section', { class: 'side-panel', dataset: { panel: 'search' } });
  body = h('div', { class: 'side-body' }, panels.repos, panels.docs, panels.search);
  const resizer = h('div', { class: 'side-resizer', title: 'Breite ändern' });
  el.append(tabs, body, resizer);
  initResize(resizer);
  docsApi = renderDocsPanel(panels.docs);
  searchApi = renderSearchPanel(panels.search);
  showPanel('repos');
  renderRepos();
  app.on('projects-changed', debounce(renderRepos, 30));
  app.on('tree-changed', debounce(renderRepos, 30));
  app.on('live-peers', debounce(renderRepos, 120));
  app.on('live-status', debounce(renderRepos, 60));
  app.on('sync-progress', debounce(renderRepos, 100));
  app.on('reveal-file', ({ projectId, path, force }) => reveal(projectId, path, force));
}

function tabBtn(id, ic, label) {
  return h('button', { class: 'side-tab', dataset: { panel: id }, onclick: () => showPanel(id) }, frag(ic), h('span', {}, label));
}

export function showPanel(id, opts = {}) {
  currentPanel = id;
  for (const [k, p] of Object.entries(panels)) p.hidden = k !== id;
  el.querySelectorAll('[data-panel]').forEach((b) => b.classList?.toggle('active', b.dataset.panel === id && b.tagName === 'BUTTON'));
  if (id === 'docs') { if (opts.lang != null) docsApi.setLang(opts.lang); if (opts.focus) docsApi.focus(); }
  if (id === 'search' && opts.focus !== false) searchApi.focus(opts.query);
}

function initResize(handle) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX, startW = el.offsetWidth;
    document.body.classList.add('resizing');
    const move = (ev) => { const w = Math.max(200, Math.min(640, startW + ev.clientX - startX)); document.documentElement.style.setProperty('--sidebar-w', w + 'px'); };
    const up = (ev) => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      app.set('sidebarWidth', Math.max(200, Math.min(640, startW + ev.clientX - startX)));
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
}

// ---------- Repos ----------
async function ensureExpanded(p) {
  if (!expanded.has(p.id)) expanded.set(p.id, new Set(await kv.get('expanded:' + p.id, [])));
  return expanded.get(p.id);
}
const saveExpanded = debounce((id) => kv.set('expanded:' + id, [...expanded.get(id)]), 300);

let renderToken = 0;
async function renderRepos() {
  const token = ++renderToken;
  for (const p of P.list) { await getFiles(p).catch(() => {}); await ensureExpanded(p); }
  if (token !== renderToken) return;
  const scroll = panels.repos.scrollTop;
  const add = h('button', { class: 'add-repo', onclick: (e) => addRepositoryMenu(e.currentTarget) }, frag(icon.plus), h('span', {}, 'Repository hinzufügen'));
  const list = h('div', { class: 'repo-list' }, P.list.map(renderRepo));
  if (!P.list.length) list.append(h('div', { class: 'empty-side' }, h('p', {}, 'Noch keine Repositories.'), h('p', { class: 'muted' }, 'Erstelle ein Projekt, öffne einen Ordner oder importiere von GitHub.')));
  panels.repos.replaceChildren(add, list);
  panels.repos.scrollTop = scroll;
}

function repoLogo(p) {
  const letter = (p.name.match(/[A-Za-z0-9]/)?.[0] || '?').toLowerCase();
  if (p.source === 'github') return h('span', { class: 'repo-logo gh' }, frag(icon.github));
  return h('span', { class: 'repo-logo', style: { background: p.color } }, letter + '.');
}

function renderRepo(p) {
  const session = getSession(p.id);
  const branchInfo = p.branches?.[p.branch];
  const syncing = Object.entries(p.branches || {}).find(([, b]) => b.status === 'syncing');
  const head = h('div', { class: 'repo-head' + (p.collapsed ? ' collapsed' : '') },
    h('button', { class: 'repo-title', onclick: () => { p.collapsed = !p.collapsed; import('../projects/projects.js').then((m) => m.saveProject(p)); renderRepos(); }, title: p.collapsed ? 'Aufklappen' : 'Zuklappen' },
      repoLogo(p),
      h('span', { class: 'repo-name' }, p.name)),
    h('button', { class: 'repo-branch', title: 'Branch wechseln', onclick: (e) => openBranchMenu(p, e.currentTarget) },
      h('span', { class: 'slash' }, '/'), h('span', {}, p.branch), frag(icon.caretDown)),
    session ? h('span', { class: 'live-badge ' + session.status, title: session.status === 'online' ? 'Live – verbunden' : session.status === 'local' ? 'Live – nur dieses Gerät (kein Server)' : 'Live – verbinde …' }, frag(icon.broadcast)) : null,
    syncing ? h('span', { class: 'repo-sync', title: `„${syncing[0]}“ wird synchronisiert` }, frag(icon.spinner), `${Math.round((syncing[1].progress || 0) * 100)}%`) : null,
    h('span', { class: 'grow' }),
    h('button', { class: 'icon-btn more', title: 'Repository-Aktionen', onclick: (e) => openRepoMenu(p, e.currentTarget) }, frag(icon.more)),
  );
  head.addEventListener('contextmenu', (e) => { e.preventDefault(); openRepoMenu(p, { x: e.clientX, y: e.clientY }); });
  const wrap = h('div', { class: 'repo', dataset: { id: p.id } }, head);
  if (!p.collapsed) {
    const files = filesSync(p);
    if (branchInfo?.status !== 'synced' && (!files || !files.size)) {
      wrap.append(h('div', { class: 'tree-note' }, branchInfo?.status === 'syncing' ? 'Wird synchronisiert …' : h('span', {}, 'Branch nicht synchronisiert. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); syncBranch(p, p.branch).catch(() => {}); } }, 'Jetzt synchronisieren'))));
    } else {
      const tree = h('div', { class: 'tree', role: 'tree' });
      const exp = expanded.get(p.id);
      const peersByFile = new Map();
      for (const peer of session?.peers() || []) if (peer.file) { if (!peersByFile.has(peer.file)) peersByFile.set(peer.file, []); peersByFile.get(peer.file).push(peer); }
      const rows = [];
      const walk = (node, depth) => {
        for (const child of sortedChildren(node)) {
          rows.push(renderRow(p, child, depth, exp, peersByFile));
          if (child.dir && (exp.has(child.path) || p.display !== 'all')) walk(child, depth + 1);
        }
      };
      walk(buildTree(p), 0);
      if (!rows.length) rows.push(h('div', { class: 'tree-note' }, p.display === 'ignored' ? 'Keine ignorierten Dateien.' : p.display === 'unindexed' ? 'Alle Dateien sind indiziert.' : 'Leer – lege eine Datei an.'));
      tree.append(...rows);
      wrap.append(tree);
      // Dateien vom Betriebssystem hineinziehen
      tree.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); tree.classList.add('drop'); } });
      tree.addEventListener('dragleave', () => tree.classList.remove('drop'));
      tree.addEventListener('drop', async (e) => {
        tree.classList.remove('drop');
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        const target = e.target.closest('.row');
        const base = target ? (target.dataset.dir === '1' ? target.dataset.path : dirname(target.dataset.path)) : '';
        const n = await importFiles(p, [...e.dataTransfer.files], base);
        toast(`${n} Datei(en) importiert.`, { type: 'success' });
      });
    }
  }
  return wrap;
}

function renderRow(p, node, depth, exp, peersByFile) {
  const open = node.dir && (exp.has(node.path) || p.display !== 'all');
  const rec = node.rec;
  const cls = ['row'];
  if (node.dir) cls.push('dir');
  if (selected?.projectId === p.id && selected.path === node.path) cls.push('selected');
  if (rec) {
    if (rec.conflict) cls.push('conflict');
    else if (isModified(rec)) cls.push('modified');
    else if (isNew(rec) && p.source !== 'local' && p.source !== 'live') cls.push('added');
    if (!isIndexed(rec)) cls.push('unindexed');
  }
  if (node.ignored) cls.push('ignored');
  const peers = peersByFile.get(node.path) || [];
  const row = h('div', {
    class: cls.join(' '), role: 'treeitem', tabindex: '-1', style: { '--depth': depth },
    dataset: { path: node.path, dir: node.dir ? '1' : '0' },
    draggable: node.dir ? null : 'true',
    title: rec ? `${node.path}${rec.size ? ' · ' + formatBytes(rec.size) : ''}${rec.remote ? ' · nicht indiziert (lädt beim Öffnen)' : ''}${isModified(rec) ? ' · geändert' : ''}` : node.path,
  },
  node.dir ? h('span', { class: 'chev' }, frag(open ? icon.chevronDown : icon.chevronRight)) : h('span', { class: 'chev' }),
  frag(node.dir ? (open ? icon.folderOpen : icon.folder) : fileIcon(node.path)),
  h('span', { class: 'name' }, node.name),
  peers.length ? h('span', { class: 'row-peers' }, peers.slice(0, 3).map((x) => h('i', { style: { background: x.user.color }, title: x.user.name + ' ist hier' }))) : null,
  rec && isModified(rec) ? h('span', { class: 'row-badge', title: 'Geändert' }, 'M') : null);

  row.addEventListener('click', () => {
    selected = { projectId: p.id, path: node.path };
    if (node.dir) {
      if (p.display !== 'all') return;
      exp.has(node.path) ? exp.delete(node.path) : exp.add(node.path);
      saveExpanded(p.id);
      renderRepos();
    } else {
      openFile(p, node.path);
      app.emit('sidebar-file-opened');
      el.querySelectorAll('.row.selected').forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
    }
  });
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); fileMenu(p, node.path, { x: e.clientX, y: e.clientY }, node.dir); });
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-luna-file', JSON.stringify({ projectId: p.id, path: node.path }));
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  // Langes Drücken auf Touch = Kontextmenü
  let lp;
  row.addEventListener('touchstart', (e) => { lp = setTimeout(() => { const t = e.touches[0]; fileMenu(p, node.path, { x: t.clientX, y: t.clientY }, node.dir); }, 550); }, { passive: true });
  row.addEventListener('touchend', () => clearTimeout(lp));
  row.addEventListener('touchmove', () => clearTimeout(lp), { passive: true });
  return row;
}

async function reveal(projectId, path, force) {
  const p = getProject(projectId);
  if (!p) return;
  const exp = await ensureExpanded(p);
  let changed = false;
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) { const d = parts.slice(0, i).join('/'); if (!exp.has(d)) { exp.add(d); changed = true; } }
  if (p.collapsed && force) { p.collapsed = false; changed = true; }
  selected = { projectId, path };
  if (changed) { saveExpanded(p.id); await renderRepos(); }
  const row = panels.repos.querySelector(`.repo[data-id="${p.id}"] .row[data-path="${CSS.escape(path)}"]`);
  panels.repos.querySelectorAll('.row.selected').forEach((r) => r.classList.remove('selected'));
  if (row) { row.classList.add('selected'); row.scrollIntoView({ block: 'nearest' }); }
  if (force) showPanel('repos');
}

// ---------- Menüs ----------
export function openRepoMenu(p, anchor) {
  const session = getSession(p.id);
  const mode = p.display || 'all';
  const items = [
    { label: 'Neu synchronisieren', icon: icon.refresh, onClick: () => resync(p), disabled: !['github', 'folder'].includes(p.source) },
    { label: 'Branch', icon: icon.pr, hint: p.branch, submenu: () => branchPanel(p) },
    '-',
    { section: 'Anzeige' },
    { label: 'Alle Dateien', icon: icon.file, checked: mode === 'all', onClick: () => setDisplay(p, 'all') },
    { label: 'Ignorierte Dateien', icon: icon.fileIgnored, checked: mode === 'ignored', onClick: () => setDisplay(p, 'ignored') },
    { label: 'Nicht indiziert', icon: icon.fileX, checked: mode === 'unindexed', onClick: () => setDisplay(p, 'unindexed') },
    '-',
    { label: 'Neue Datei …', icon: icon.newFile, onClick: () => newFile(p, '') },
    { label: 'Neuer Ordner …', icon: icon.newFolder, onClick: () => newFolder(p, '') },
    { label: session ? 'Live-Session beenden' : 'Live-Session starten', icon: icon.broadcast, onClick: () => (session ? stopSession(p) : startSession(p).then(() => app.emit('show-live', p))) },
    { label: 'Umbenennen …', icon: icon.edit, onClick: async () => { const n = await prompt('Repository umbenennen', { value: p.name }); if (n) renameProject(p, n); } },
    { label: 'Als ZIP herunterladen', icon: icon.download, onClick: async () => download(`${p.name}-${p.branch}.zip`, await zipProject(p)) },
    p.source === 'folder' ? { label: 'Änderungen in Ordner schreiben', icon: icon.upload, onClick: async () => { try { const n = await writeBackFolder(p); toast(`${n} Datei(en) gespeichert.`, { type: 'success' }); } catch (e) { toast(e.message, { type: 'error' }); } } } : null,
    p.source === 'github' ? { label: 'Änderungen pushen …', icon: icon.upload, onClick: async () => {
      const msg = await prompt('Änderungen nach GitHub pushen', { value: 'Änderungen aus Luna', label: `${p.owner}/${p.repo} · Branch ${p.branch} – Commit-Nachricht:`, ok: 'Pushen' });
      if (!msg) return;
      try { const n = await pushChanges(p, msg); if (!n) toast('Keine Änderungen zum Pushen.'); } catch (e) { toast(e.message, { type: 'error' }); }
    } } : null,
    p.source === 'github' ? { label: 'Auf GitHub öffnen', icon: icon.github, onClick: () => window.open(`${p.htmlUrl || `https://github.com/${p.owner}/${p.repo}`}/tree/${p.branch}`, '_blank', 'noopener') } : null,
    P.list.length > 1 ? { label: 'Nach oben', icon: icon.arrowLeft, onClick: () => moveProject(p, -1), disabled: P.list[0] === p } : null,
    '-',
    { label: 'Aus Projekt entfernen', icon: icon.trash, onClick: async () => {
      if (await confirm('Repository entfernen?', `„${p.name}“ wird mit allen lokalen Dateien und Änderungen aus Luna entfernt.`, { ok: 'Entfernen', danger: true })) {
        if (session) await stopSession(p);
        await removeProject(p);
      }
    } },
  ];
  showMenu(anchor, items, { align: 'end', className: 'repo-menu' });
}

async function resync(p) {
  const src = P.remote.get(p.source);
  if (!src?.resync) return;
  try { await src.resync(p); } catch (e) { if (e.name !== 'AbortError') toast(e.message, { type: 'error' }); }
}

function openBranchMenu(p, anchor) {
  showMenu(anchor, [{ custom: branchPanel(p) }], { className: 'branch-menu' });
}

/** Branch-Panel wie in Bild 1: Suche + „Synchronisiert / Wird synchronisiert / Nicht synchronisiert“ */
function branchPanel(p) {
  const input = h('input', { class: 'bp-search', placeholder: 'Branches suchen …', autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'bp-list' });
  const panel = h('div', { class: 'branch-panel' }, input, list);
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const entries = Object.entries(p.branches || {}).filter(([n]) => n.toLowerCase().includes(q));
    const groups = { synced: [], syncing: [], remote: [] };
    for (const [name, b] of entries) (groups[b.status] || groups.remote).push([name, b]);
    const rows = [];
    const sec = (title, arr, fn) => { if (!arr.length) return; rows.push(h('div', { class: 'bp-section' }, title)); arr.sort((a, b) => (a[0] === p.defaultBranch ? -1 : b[0] === p.defaultBranch ? 1 : a[0].localeCompare(b[0]))).forEach(([n, b]) => rows.push(fn(n, b))); };
    sec('Synchronisiert', groups.synced, (name, b) => h('button', {
      class: 'bp-row' + (name === p.branch ? ' current' : ''), title: b.syncedAt ? 'Synchronisiert ' + timeAgo(b.syncedAt) : '',
      onclick: async () => { closeMenus(0); if (name !== p.branch) await switchBranch(p, name); },
      oncontextmenu: (e) => { e.preventDefault(); if (name !== p.branch && confirmDeleteBranch) confirmDeleteBranch(p, name).then(render); },
    }, frag(icon.pr), h('span', { class: 'bp-name' }, name), name === p.defaultBranch ? h('span', { class: 'bp-badge' }, 'Standard') : null, name === p.branch ? h('span', { class: 'check' }, frag(icon.check)) : null));
    sec('Wird synchronisiert', groups.syncing, (name, b) => h('div', { class: 'bp-row syncing' }, frag(icon.spinner), h('span', { class: 'bp-name' }, name),
      h('span', { class: 'bp-progress' }, `${Math.round((b.progress || 0) * 100)}%`),
      h('button', { class: 'bp-action danger', onclick: () => cancelSync(p, name) }, 'Abbrechen')));
    sec('Nicht synchronisiert', groups.remote, (name) => h('div', { class: 'bp-row remote' }, frag(icon.pr), h('span', { class: 'bp-name' }, name),
      h('button', { class: 'bp-action', onclick: () => syncBranch(p, name).catch(() => {}) }, 'Sync')));
    if (q && !p.branches[input.value.trim()] && p.source !== 'live') {
      rows.push(h('div', { class: 'menu-sep' }), h('button', { class: 'bp-row create', onclick: async () => {
        try { closeMenus(0); await createBranch(p, input.value.trim()); toast(`Branch „${input.value.trim()}“ erstellt (aus ${p.branches[p.branch]?.from || 'aktuellem Stand'}).`, { type: 'success' }); }
        catch (e) { toast(e.message, { type: 'error' }); }
      } }, frag(icon.plus), h('span', { class: 'bp-name' }, `Branch „${input.value.trim()}“ aus „${p.branch}“ erstellen`)));
    }
    if (!rows.length) rows.push(h('div', { class: 'bp-empty' }, 'Keine Branches gefunden.'));
    list.replaceChildren(...rows);
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') list.querySelector('.bp-row.create, .bp-row:not(.current)')?.click(); });
  const off = [app.on('projects-changed', render), app.on('sync-progress', render)];
  const mo = new MutationObserver(() => { if (!panel.isConnected) { off.forEach((f) => f()); mo.disconnect(); } });
  requestAnimationFrame(() => mo.observe(document.body, { childList: true }));
  if (p.source === 'github') listBranches(p).then(render).catch(() => {});
  render();
  requestAnimationFrame(() => input.focus());
  return panel;
}

async function confirmDeleteBranch(p, name) {
  if (await confirm('Branch entfernen?', `Lokale Kopie von „${name}“ löschen?`, { ok: 'Löschen', danger: true })) {
    try { await deleteBranch(p, name); } catch (e) { toast(e.message, { type: 'error' }); }
  }
}

export function fileMenu(p, path, anchor, isDir = false) {
  const folder = isDir ? path : dirname(path);
  const items = [
    !isDir ? { label: 'Öffnen', icon: icon.file, onClick: () => openFile(p, path) } : null,
    !isDir ? { label: 'Im geteilten Bereich öffnen', icon: icon.splitDown, onClick: () => app.emit('open-split', { project: p, path }) } : null,
    { label: 'Neue Datei …', icon: icon.newFile, onClick: () => newFile(p, folder) },
    { label: 'Neuer Ordner …', icon: icon.newFolder, onClick: () => newFolder(p, folder) },
    '-',
    { label: 'Umbenennen …', icon: icon.edit, shortcut: 'F2', onClick: () => renameItem(p, path) },
    !isDir ? { label: 'Duplizieren', icon: icon.copy, onClick: async () => { const t = await duplicatePath(p, path); if (t) openFile(p, t); } } : null,
    { label: 'Pfad kopieren', icon: icon.link, onClick: () => copyText(path).then(() => toast('Pfad kopiert.')) },
    !isDir ? { label: 'Herunterladen', icon: icon.download, onClick: async () => { const r = (await getFiles(p)).get(path); download(basename(path), r.blob || r.content || ''); } } : null,
    '-',
    { label: 'Löschen', icon: icon.trash, danger: true, onClick: async () => {
      if (await confirm(isDir ? 'Ordner löschen?' : 'Datei löschen?', `„${path}“ ${isDir ? 'und alle enthaltenen Dateien werden' : 'wird'} gelöscht.`, { ok: 'Löschen', danger: true })) deletePath(p, path);
    } },
  ];
  showMenu(anchor, items, { align: 'end' });
}

export async function newFile(p, folder) {
  const name = await prompt('Neue Datei', { placeholder: 'z. B. spiel.luna', value: folder ? folder + '/' : '', label: `In „${p.name}“ – Unterordner mit / angeben` });
  if (!name) return;
  try {
    await createFile(p, name.replace(/^\/+/, ''));
    const exp = await ensureExpanded(p);
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) exp.add(parts.slice(0, i).join('/'));
    saveExpanded(p.id);
    openFile(p, name.replace(/^\/+/, '').replace(/\/+/g, '/'));
  } catch (e) { toast(e.message, { type: 'error' }); }
}

export async function newFolder(p, folder) {
  const name = await prompt('Neuer Ordner', { value: folder ? folder + '/' : '', placeholder: 'ordnername' });
  if (!name) return;
  try { await createFolder(p, name.replace(/\/+$/, '')); (await ensureExpanded(p)).add(name.replace(/\/+$/, '')); renderRepos(); }
  catch (e) { toast(e.message, { type: 'error' }); }
}

export async function renameItem(p, path) {
  const name = await prompt('Umbenennen', { value: path, selectBase: true });
  if (!name || name === path) return;
  try { await renamePath(p, path, name); } catch (e) { toast(e.message, { type: 'error' }); }
}

// ---------- Suche in Dateien ----------
function renderSearchPanel(container) {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'In Dateien suchen …', autocomplete: 'off', spellcheck: 'false' });
  const caseBtn = h('button', { class: 'toggle', title: 'Groß-/Kleinschreibung beachten', onclick: () => { caseBtn.classList.toggle('on'); run(); } }, 'Aa');
  const reBtn = h('button', { class: 'toggle', title: 'Regulärer Ausdruck', onclick: () => { reBtn.classList.toggle('on'); run(); } }, '.*');
  const info = h('div', { class: 'search-info muted' });
  const results = h('div', { class: 'search-results' });
  container.replaceChildren(h('div', { class: 'search-box' }, h('div', { class: 'docs-search' }, frag(icon.search), input, caseBtn, reBtn), info), results);
  const run = debounce(() => {
    const q = input.value;
    results.replaceChildren();
    if (!q) { info.textContent = ''; return; }
    let re;
    try { re = new RegExp(reBtn.classList.contains('on') ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseBtn.classList.contains('on') ? 'g' : 'gi'); }
    catch { info.textContent = 'Ungültiger regulärer Ausdruck.'; return; }
    let total = 0, filesHit = 0, skipped = 0;
    for (const p of P.list) {
      const files = filesSync(p);
      if (!files) continue;
      for (const rec of files.values()) {
        if (total > 500) break;
        if (rec.placeholder) continue;
        if (rec.content == null) { skipped++; continue; }
        const lines = rec.content.split('\n');
        const hits = [];
        lines.forEach((line, i) => {
          re.lastIndex = 0;
          const m = re.exec(line);
          if (m && hits.length < 50) hits.push({ line: i + 1, col: m.index + 1, text: line, len: m[0].length || 1 });
        });
        if (!hits.length) continue;
        filesHit++; total += hits.length;
        results.append(h('div', { class: 'sr-file' },
          h('div', { class: 'sr-head', onclick: () => openFile(p, rec.path) }, frag(fileIcon(rec.path)), h('span', { class: 'name' }, basename(rec.path)), h('span', { class: 'muted path' }, `${p.name} / ${dirname(rec.path)}`), h('span', { class: 'count' }, hits.length)),
          hits.map((m) => {
            const start = Math.max(0, m.col - 30);
            const pre = m.text.slice(start, m.col - 1), hit = m.text.slice(m.col - 1, m.col - 1 + m.len), post = m.text.slice(m.col - 1 + m.len, m.col + 80);
            return h('div', { class: 'sr-line', onclick: () => openFile(p, rec.path, { line: m.line, col: m.col }) },
              h('span', { class: 'ln' }, m.line), h('span', { class: 'txt', html: `${start ? '…' : ''}${escapeHtml(pre.trimStart())}<mark>${escapeHtml(hit)}</mark>${escapeHtml(post)}` }));
          })));
      }
    }
    info.textContent = total ? `${total} Treffer in ${filesHit} Datei(en)${skipped ? ` · ${skipped} nicht indiziert` : ''}` : `Keine Treffer${skipped ? ` · ${skipped} Dateien nicht indiziert` : ''}.`;
  }, 200);
  input.addEventListener('input', run);
  return { focus: (q) => { if (q != null) { input.value = q; run(); } input.focus(); input.select(); } };
}

export { renderRepos };
