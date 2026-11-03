// Editor-Bereich: Tabs, geteilte Ansicht (Bild 2), Datei-Kopfzeile (Bild 1), Statuszeile (Bild 2/4).
import {
  EditorView, EditorState, Compartment, Annotation, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, indentOnInput, bracketMatching,
  foldGutter, foldKeymap, indentUnit, history, historyKeymap, defaultKeymap, indentWithTab, closeBrackets, closeBracketsKeymap,
  searchKeymap, highlightSelectionMatches, search, lintKeymap, acceptCompletion, yCollab, yUndoManagerKeymap, Y, EditorSelection,
} from '../../vendor/core.js';
import { app } from '../core/store.js';
import { h, frag, basename, dirname, debounce, isImagePath, isMac, setChildren } from '../core/util.js';
import { icon, fileIcon, specialIcon } from '../core/icons.js';
import { keyboard } from '../core/keyboard.js';
import { kv } from '../core/db.js';
import { langIdFor, langInfo, loadLanguage } from '../core/langs.js';
import { lunaTheme, editorHighlighting, indentGuides, gutterScrollPadding } from './theme.js';
import { lunaCompletion, fileLangFacet } from './completion.js';
import { lunaLinter, diagnosticBadges, symbolPath, diagnosticCount } from './diagnostics.js';
import { fileCtxFacet, isLunaPath } from '../luna/project.js';
import { forceLinting } from '../../vendor/core.js';
import { getProject, readFile, writeFile, getFiles, getRec } from '../projects/projects.js';
import { getSession } from '../collab/session.js';
import { getEntry } from '../docs/registry.js';
import { renderDocPage } from '../docs/view.js';

const External = Annotation.define();
const comp = { lang: new Compartment(), settings: new Compartment(), completion: new Compartment(), lint: new Compartment() };

let root;
const panes = [];
let activePane = null;
let tabSeq = 0;
const navStack = { back: [], forward: [], lock: false };
let recent = [];

export const editor = { panes, get activePane() { return activePane; } };
export { panes };

// ---------- Erweiterungen ----------
function settingsExt() {
  const s = app.settings;
  return [
    EditorState.tabSize.of(s.tabSize),
    indentUnit.of(' '.repeat(s.tabSize)),
    s.lineWrapping ? EditorView.lineWrapping : [],
    EditorView.theme({ '.cm-scroller': { fontSize: s.fontSize + 'px' } }),
  ];
}
const completionExt = () => (app.settings.smartMode && keyboard.present ? lunaCompletion() : []);
const lintExt = () => (app.settings.smartMode ? [lunaLinter, diagnosticBadges] : []);

const foldMarker = (open) => frag(open ? icon.chevronDown : icon.chevronRight);

function baseExtensions(tab) {
  return [
    fileLangFacet.of(tab.langId),
    fileCtxFacet.of({ projectId: tab.projectId, path: tab.path }),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    foldGutter({ markerDOM: foldMarker }),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    editorHighlighting,
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    indentGuides,
    gutterScrollPadding,
    lunaTheme,
    search({ top: true }),
    comp.lang.of([]),
    comp.settings.of(settingsExt()),
    comp.completion.of(completionExt()),
    comp.lint.of(lintExt()),
    keymap.of([
      { key: 'Tab', run: acceptCompletion },
      { key: 'Mod-Enter', preventDefault: true, run: () => { app.emit('run'); return true; } },
      ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...foldKeymap, ...lintKeymap, indentWithTab,
      { key: 'Mod-s', preventDefault: true, run: () => { app.emit('save-request'); return true; } },
    ]),
    EditorView.updateListener.of((u) => onViewUpdate(tab, u)),
    EditorView.domEventHandlers({
      focus: () => { setActivePane(tab.pane); notifyActive(tab); return false; },
    }),
    EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
  ];
}

// ---------- Panes ----------
function createPane() {
  const pane = { tabs: [], active: null };
  pane.tabbar = h('div', { class: 'tabbar', role: 'tablist' });
  pane.tabsEl = h('div', { class: 'tabs' });
  pane.actions = h('div', { class: 'tabbar-actions' },
    h('button', { class: 'icon-btn sm', title: 'Ansicht teilen', onclick: () => toggleSplit() }, frag(icon.splitDown)),
    h('button', { class: 'icon-btn sm pane-close', title: 'Bereich schließen', onclick: () => closePane(pane) }, frag(icon.close)),
  );
  pane.tabbar.append(pane.tabsEl, pane.actions);
  pane.header = h('div', { class: 'file-header' });
  pane.body = h('div', { class: 'pane-body' });
  pane.inspect = h('button', { class: 'inspection', title: 'Probleme', onclick: () => app.emit('show-problems') });
  pane.peersEl = h('div', { class: 'pane-peers' });
  pane.status = h('div', { class: 'statusline' });
  pane.el = h('section', { class: 'pane', onpointerdown: () => setActivePane(pane) }, pane.tabbar, pane.header, h('div', { class: 'pane-main' }, pane.body, pane.inspect, pane.peersEl), pane.status);
  pane.tabsEl.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { pane.tabsEl.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  // Dateien aus der Seitenleiste hineinziehen
  pane.el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-luna-file')) { e.preventDefault(); pane.el.classList.add('drop'); } });
  pane.el.addEventListener('dragleave', () => pane.el.classList.remove('drop'));
  pane.el.addEventListener('drop', (e) => {
    pane.el.classList.remove('drop');
    const raw = e.dataTransfer.getData('application/x-luna-file');
    if (!raw) return;
    e.preventDefault();
    const { projectId, path } = JSON.parse(raw);
    const p = getProject(projectId);
    if (p) openFile(p, path, { pane });
  });
  panes.push(pane);
  root.append(pane.el);
  renderPaneChrome(pane);
  return pane;
}

function setActivePane(pane) {
  if (activePane === pane) return;
  activePane = pane;
  for (const p of panes) p.el.classList.toggle('active', p === pane);
  app.emit('active-tab', pane.active);
}

export function toggleSplit(orientation) {
  if (panes.length > 1 && !orientation) { closePane(panes[1]); return; }
  if (orientation) root.dataset.split = orientation;
  if (panes.length < 2) {
    const src = activePane.active;
    const pane = createPane();
    root.classList.add('split');
    if (src?.kind === 'file') openFile(getProject(src.projectId), src.path, { pane });
    else if (src?.kind === 'doc') openDoc(src.docId, { pane });
    else openWelcome(pane);
  }
}

function closePane(pane) {
  if (panes.length < 2) return;
  for (const t of [...pane.tabs]) destroyTab(t);
  pane.el.remove();
  panes.splice(panes.indexOf(pane), 1);
  root.classList.remove('split');
  activePane = null;
  setActivePane(panes[0]);
}

// ---------- Tabs ----------
function findTab(pred, pane) {
  for (const p of pane ? [pane] : panes) { const t = p.tabs.find(pred); if (t) return t; }
  return null;
}
export const allTabs = () => panes.flatMap((p) => p.tabs);
export const activeTab = () => activePane?.active || null;

function addTab(pane, tab) {
  tab.id = ++tabSeq;
  tab.pane = pane;
  tab.el = h('div', { class: 'tab-content' });
  pane.body.append(tab.el);
  const i = pane.active ? pane.tabs.indexOf(pane.active) + 1 : pane.tabs.length;
  pane.tabs.splice(i, 0, tab);
  return tab;
}

export async function openFile(project, path, { pane = activePane, line, col, pos, focus = true, from = 'user' } = {}) {
  if (!project) return null;
  let tab = findTab((t) => t.kind === 'file' && t.projectId === project.id && t.path === path, pane);
  if (!tab) {
    tab = addTab(pane, { kind: 'file', projectId: project.id, path, title: basename(path), langId: langIdFor(path) });
    renderTabs(pane);
    try { await mountFile(tab, project); }
    catch (e) {
      tab.el.replaceChildren(h('div', { class: 'empty-state' }, frag(icon.error), h('h3', {}, 'Datei konnte nicht geöffnet werden'), h('p', {}, e.message)));
    }
  }
  activate(tab, { focus, from });
  if (tab.view && (line || pos != null)) {
    const doc = tab.view.state.doc;
    const at = pos != null ? Math.min(pos, doc.length) : Math.min(doc.line(Math.min(line, doc.lines)).from + Math.max(0, (col || 1) - 1), doc.length);
    tab.view.dispatch({ selection: EditorSelection.cursor(at), effects: EditorView.scrollIntoView(at, { y: 'center' }) });
  }
  pushRecent(project, path);
  return tab;
}

async function mountFile(tab, project) {
  const rec = (await getFiles(project)).get(tab.path);
  if (!rec) throw new Error('Die Datei existiert nicht mehr.');
  if (rec.binary || rec.content == null && !rec.remote) {
    tab.binary = true;
    if (isImagePath(tab.path)) {
      const src = rec.blob ? URL.createObjectURL(rec.blob) : project.source === 'github' ? `https://raw.githubusercontent.com/${project.owner}/${project.repo}/${project.branch}/${tab.path}` : null;
      tab.objectUrl = rec.blob ? src : null;
      tab.el.append(h('div', { class: 'image-view' }, src ? h('img', { src, alt: tab.path }) : h('p', {}, 'Keine Vorschau verfügbar.')));
    } else {
      tab.el.append(h('div', { class: 'empty-state' }, frag(icon.file), h('h3', {}, 'Binärdatei'), h('p', {}, 'Diese Datei kann nicht als Text bearbeitet werden.')));
    }
    return;
  }
  tab.el.append(h('div', { class: 'loading-line' }));
  let content = rec.content;
  if (content == null) content = await readFile(project, tab.path);
  const session = getSession(project.id);
  let ytext = null;
  if (session) ytext = session.textFor(tab.path, content);
  tab.collab = !!ytext;
  const extensions = [
    baseExtensions(tab),
    tab.collab ? [yCollab(ytext, session.awareness), keymap.of(yUndoManagerKeymap)] : [history(), keymap.of(historyKeymap)],
  ];
  const state = EditorState.create({ doc: tab.collab ? ytext.toString() : content ?? '', extensions });
  tab.el.replaceChildren();
  tab.view = new EditorView({ state, parent: tab.el });
  tab.write = debounce(() => {
    const p = getProject(tab.projectId);
    if (p && tab.view) writeFile(p, tab.path, tab.view.state.doc.toString(), { origin: tab.collab ? 'editor-collab' : 'view-' + tab.id });
  }, 150);
  loadLanguage(tab.langId).then((ext) => tab.view?.dispatch({ effects: comp.lang.reconfigure(ext) }));
}

export function openDoc(id, { pane = activePane } = {}) {
  const entry = getEntry(id);
  if (!entry) return null;
  let tab = findTab((t) => t.kind === 'doc', pane);
  if (!tab) tab = addTab(pane, { kind: 'doc' });
  tab.docId = id;
  tab.title = entry.label;
  tab.el.replaceChildren(renderDocPage(entry));
  activate(tab, { focus: false });
  tab.el.scrollTop = 0;
  return tab;
}

export function openWelcome(pane = activePane) {
  let tab = findTab((t) => t.kind === 'welcome', pane);
  if (!tab) {
    tab = addTab(pane, { kind: 'welcome', title: 'Willkommen' });
    app.emit('render-welcome', tab.el);
  }
  activate(tab, { focus: false });
  return tab;
}

export function openCustom(key, title, render, { pane = activePane, iconKey = 'preview' } = {}) {
  let tab = findTab((t) => t.kind === 'custom' && t.key === key, pane);
  if (!tab) { tab = addTab(pane, { kind: 'custom', key, title, iconKey }); render(tab.el, tab); }
  activate(tab, { focus: false });
  return tab;
}

let lastFileTab = null;
function activate(tab, { focus = true, from = 'user' } = {}) {
  const pane = tab.pane;
  if (tab.kind === 'file') lastFileTab = tab;
  const prev = pane.active;
  if (prev && prev !== tab) prev.el.classList.remove('active');
  pane.active = tab;
  tab.el.classList.add('active');
  setActivePane(pane);
  renderTabs(pane);
  renderPaneChrome(pane);
  if (tab.view) {
    tab.view.requestMeasure();
    if (focus && keyboard.present) setTimeout(() => tab.view?.focus(), 0);
  }
  if (from === 'user' && prev !== tab) pushNav(tab);
  notifyActive(tab);
  app.emit('active-tab', tab);
}

function notifyActive(tab) {
  if (tab.kind !== 'file') return;
  getSession(tab.projectId)?.setActiveFile(tab.path);
  app.emit('reveal-file', { projectId: tab.projectId, path: tab.path });
}

export function closeTab(tab) {
  const pane = tab.pane;
  const i = pane.tabs.indexOf(tab);
  tab.write?.flush();
  destroyTab(tab);
  if (pane.active === tab) {
    pane.active = null;
    const next = pane.tabs[i] || pane.tabs[i - 1];
    if (next) activate(next, { focus: false, from: 'close' });
    else if (panes.length > 1) closePane(pane);
    else { renderTabs(pane); renderPaneChrome(pane); app.emit('active-tab', null); }
  } else renderTabs(pane);
}

function destroyTab(tab) {
  const pane = tab.pane;
  tab.view?.destroy();
  tab.view = null;
  if (tab.objectUrl) URL.revokeObjectURL(tab.objectUrl);
  tab.el.remove();
  pane.tabs.splice(pane.tabs.indexOf(tab), 1);
}

export function closeOthers(tab) { for (const t of [...tab.pane.tabs]) if (t !== tab) closeTab(t); }

function tabIcon(tab) {
  if (tab.kind === 'file') return fileIcon(tab.path);
  if (tab.kind === 'doc') return specialIcon('doc');
  if (tab.kind === 'welcome') return specialIcon('welcome');
  return specialIcon(tab.iconKey || 'preview');
}

function renderTabs(pane) {
  pane.tabsEl.replaceChildren(...pane.tabs.map((tab) => {
    const peers = tab.kind === 'file' ? (getSession(tab.projectId)?.peers() || []).filter((p) => p.file === tab.path) : [];
    const el = h('div', {
      class: 'tab' + (tab === pane.active ? ' active' : '') + (tab.missing ? ' missing' : ''),
      role: 'tab', title: tab.kind === 'file' ? `${getProject(tab.projectId)?.name || ''} / ${tab.path}` : tab.title,
      draggable: tab.kind === 'file' ? 'true' : null,
      onclick: () => activate(tab),
      onauxclick: (e) => { if (e.button === 1) closeTab(tab); },
      oncontextmenu: (e) => { e.preventDefault(); app.emit('tab-menu', { tab, x: e.clientX, y: e.clientY }); },
      ondragstart: (e) => e.dataTransfer.setData('application/x-luna-file', JSON.stringify({ projectId: tab.projectId, path: tab.path })),
    },
    frag(tabIcon(tab)),
    h('span', { class: 'tab-title' }, tab.title),
    peers.length ? h('span', { class: 'tab-peers' }, peers.slice(0, 3).map((p) => h('i', { style: { background: p.user.color }, title: p.user.name }))) : null,
    h('button', { class: 'tab-close', title: 'Schließen', onclick: (e) => { e.stopPropagation(); closeTab(tab); } }, frag(icon.close)));
    return el;
  }));
  pane.active && requestAnimationFrame(() => pane.tabsEl.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  pane.el.classList.toggle('empty', !pane.tabs.length);
}

function renderPaneChrome(pane) {
  const tab = pane.active;
  // Kopfzeile (Bild 1)
  if (tab?.kind === 'file') {
    setChildren(pane.header,
      frag(fileIcon(tab.path)),
      h('span', { class: 'fh-name' }, tab.title),
      h('span', { class: 'fh-path' }, dirname(tab.path)),
      tab.collab ? h('span', { class: 'fh-live' }, frag(icon.broadcast), 'Live') : null,
      h('button', { class: 'icon-btn sm', title: 'Datei-Aktionen', onclick: (e) => app.emit('file-menu', { project: getProject(tab.projectId), path: tab.path, anchor: e.currentTarget }) }, frag(icon.more)),
    );
    pane.header.hidden = false;
  } else pane.header.hidden = true;
  updateStatus(pane);
  updateInspection(pane);
  renderPanePeers(pane);
}

// ---------- Statuszeile ----------
function updateStatus(pane) {
  const tab = pane.active;
  if (!tab) { pane.status.replaceChildren(); return; }
  if (tab.kind !== 'file') {
    pane.status.replaceChildren(h('span', { class: 'crumbs' }, tab.kind === 'doc' ? `Dokumentation / ${getEntry(tab.docId)?.langName || ''} / ${tab.title}` : tab.title));
    return;
  }
  const p = getProject(tab.projectId);
  const parts = [p?.name, ...tab.path.split('/')];
  let posText = '', symbols = [];
  if (tab.view) {
    const st = tab.view.state;
    const head = st.selection.main.head;
    const line = st.doc.lineAt(head);
    const col = head - line.from + 1;
    posText = [`Ln ${line.number}, Col ${col}`, `${line.number}:${col}`];
    symbols = symbolPath(st, head);
    const sel = st.selection.main;
    if (!sel.empty) posText[0] += ` (${Math.abs(sel.to - sel.from)} ausgewählt)`;
  }
  const crumbs = h('span', { class: 'crumbs' }, [...parts, ...symbols].map((seg, i, arr) => [
    h('span', { class: 'crumb' + (i >= parts.length ? ' sym' : ''), onclick: i === 0 ? () => app.emit('reveal-file', { projectId: tab.projectId, path: tab.path, force: true }) : null }, seg),
    i < arr.length - 1 ? h('span', { class: 'sep' }, '/') : null,
  ]));
  const kb = h('button', { class: 'kb-ind' + (keyboard.present ? ' on' : ''), title: keyboard.describe() + ' – klicken zum Umschalten', onclick: () => app.emit('cycle-completion') }, frag(icon.keyboard));
  setChildren(pane.status,
    crumbs,
    h('span', { class: 'st-right' },
      tab.view ? h('span', { class: 'st-pos long', onclick: () => app.emit('goto-line') }, posText[0]) : null,
      tab.view ? h('span', { class: 'st-pos short', onclick: () => app.emit('goto-line') }, posText[1]) : null,
      h('span', { class: 'st-enc' }, 'UTF-8'),
      h('span', { class: 'st-lang' }, langInfo(tab.langId).name),
      kb,
    ),
  );
}

function updateInspection(pane) {
  const tab = pane.active;
  const el = pane.inspect;
  if (!tab?.view || !app.settings.smartMode) { el.hidden = true; return; }
  el.hidden = false;
  const n = diagnosticCount(tab.view.state);
  el.className = 'inspection' + (n ? ' bad' : ' ok');
  el.replaceChildren(n ? h('span', {}, frag(icon.error), String(n)) : frag(icon.check));
  el.title = n ? `${n} ${n === 1 ? 'Problem' : 'Probleme'} – klicken für Details` : 'Keine Probleme gefunden';
}

function renderPanePeers(pane) {
  const tab = pane.active;
  const s = tab?.kind === 'file' ? getSession(tab.projectId) : null;
  const peers = s ? s.peers().filter((p) => p.file === tab.path) : [];
  pane.peersEl.replaceChildren(...peers.map((p) => h('button', {
    class: 'peer-chip', style: { '--c': p.user.color }, title: `${p.user.name} – zur Position springen`,
    onclick: () => followPeer(getProject(tab.projectId), p),
  }, p.user.name)));
}

const statusQueue = new Set();
const flushStatus = () => { for (const p of statusQueue) { updateStatus(p); updateInspection(p); } statusQueue.clear(); };
let statusRaf = 0;

function onViewUpdate(tab, u) {
  if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) tab.write?.();
  if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.length)) {
    if (tab.pane.active === tab) {
      statusQueue.add(tab.pane);
      cancelAnimationFrame(statusRaf);
      statusRaf = requestAnimationFrame(flushStatus);
    }
  }
}

// ---------- Externe Änderungen (andere Ansicht, Sync, Live-Spiegel) ----------
function applyExternal(view, content) {
  const old = view.state.doc.toString();
  if (old === content) return;
  let a = 0; while (a < old.length && a < content.length && old.charCodeAt(a) === content.charCodeAt(a)) a++;
  let b = 0; while (b < old.length - a && b < content.length - a && old.charCodeAt(old.length - 1 - b) === content.charCodeAt(content.length - 1 - b)) b++;
  view.dispatch({ changes: { from: a, to: old.length - b, insert: content.slice(a, content.length - b) }, annotations: [External.of(true)] });
}

const relintLuna = debounce((projectId, path) => {
  for (const t of allTabs()) if (t.view && t.projectId === projectId && t.path !== path && isLunaPath(t.path)) forceLinting(t.view);
}, 600);

app.on('file-changed', ({ project, path, origin }) => {
  if (isLunaPath(path)) relintLuna(project.id, path);
  for (const t of allTabs()) {
    if (t.kind !== 'file' || t.projectId !== project.id || t.path !== path || !t.view || t.collab) continue;
    if (origin === 'view-' + t.id) continue;
    const rec = getRec(project, path);
    if (rec?.content != null) applyExternal(t.view, rec.content);
  }
});

app.on('tree-changed', (project) => {
  for (const t of allTabs()) {
    if (t.kind !== 'file' || t.projectId !== project.id) continue;
    const rec = getRec(project, t.path);
    const missing = !rec;
    if (t.missing !== missing) { t.missing = missing; renderTabs(t.pane); }
    if (rec?.content != null && t.view && !t.collab) applyExternal(t.view, rec.content);
  }
});

app.on('paths-renamed', ({ project, moves }) => {
  for (const [from, to] of moves) {
    for (const t of allTabs()) {
      if (t.kind === 'file' && t.projectId === project.id && t.path === from) {
        t.path = to; t.title = basename(to);
        const lang = langIdFor(to);
        if (lang !== t.langId) remount(t);
      }
    }
  }
  panes.forEach((p) => { renderTabs(p); renderPaneChrome(p); });
});

app.on('paths-removed', ({ project, paths }) => {
  const set = new Set(paths);
  for (const t of allTabs()) if (t.kind === 'file' && t.projectId === project.id && set.has(t.path)) closeTab(t);
});

app.on('project-removed', (p) => { for (const t of allTabs()) if (t.projectId === p.id) closeTab(t); });

app.on('branch-switched', async (p) => {
  for (const t of allTabs()) if (t.kind === 'file' && t.projectId === p.id) {
    const exists = !!getRec(p, t.path);
    if (exists) remount(t); else closeTab(t);
  }
});

// Live-Session gestartet/beendet → Ansichten neu binden
app.on('live-changed', (p) => { for (const t of allTabs()) if (t.kind === 'file' && t.projectId === p.id) remount(t); });
app.on('live-peers', (p) => {
  for (const pane of panes) {
    if (pane.tabs.some((t) => t.projectId === p.id)) { renderTabs(pane); renderPanePeers(pane); }
  }
});

async function remount(tab) {
  const sel = tab.view?.state.selection.main.head ?? 0;
  const scroll = tab.view?.scrollDOM.scrollTop ?? 0;
  tab.write?.flush();
  tab.view?.destroy();
  tab.view = null;
  tab.el.replaceChildren();
  tab.langId = langIdFor(tab.path);
  const p = getProject(tab.projectId);
  try { await mountFile(tab, p); } catch (e) { tab.el.replaceChildren(h('div', { class: 'empty-state' }, h('p', {}, e.message))); }
  if (tab.view) {
    tab.view.dispatch({ selection: EditorSelection.cursor(Math.min(sel, tab.view.state.doc.length)) });
    tab.view.scrollDOM.scrollTop = scroll;
  }
  renderPaneChrome(tab.pane);
}

// ---------- Einstellungen / Tastatur ----------
export function reconfigureAll() {
  for (const t of allTabs()) {
    if (!t.view) continue;
    t.view.dispatch({ effects: [comp.settings.reconfigure(settingsExt()), comp.completion.reconfigure(completionExt()), comp.lint.reconfigure(lintExt())] });
  }
  panes.forEach((p) => { updateStatus(p); updateInspection(p); });
}
app.on('settings', ({ key }) => { if (['fontSize', 'tabSize', 'lineWrapping', 'smartMode', 'completion'].includes(key)) reconfigureAll(); });
keyboard.on('change', () => reconfigureAll());

// ---------- Live: Person folgen ----------
export async function followPeer(project, peer) {
  if (!peer.file) return;
  const tab = await openFile(project, peer.file);
  const s = getSession(project.id);
  if (!tab?.view || !s || !peer.cursor?.head) return;
  const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(peer.cursor.head), s.doc);
  if (abs) tab.view.dispatch({ effects: EditorView.scrollIntoView(Math.min(abs.index, tab.view.state.doc.length), { y: 'center' }) });
}

// ---------- Navigation (Zurück / Vor) & Verlauf ----------
function navKey(tab) { return tab.kind === 'file' ? { kind: 'file', projectId: tab.projectId, path: tab.path } : tab.kind === 'doc' ? { kind: 'doc', docId: tab.docId } : null; }
function pushNav(tab) {
  if (navStack.lock) return;
  const k = navKey(tab);
  if (!k) return;
  const last = navStack.back[navStack.back.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(k)) return;
  navStack.back.push(k);
  if (navStack.back.length > 100) navStack.back.shift();
  navStack.forward.length = 0;
  app.emit('nav-changed');
}
async function goNav(k) {
  navStack.lock = true;
  try {
    if (k.kind === 'file') { const p = getProject(k.projectId); if (p) await openFile(p, k.path, { from: 'nav' }); }
    else openDoc(k.docId);
  } finally { navStack.lock = false; app.emit('nav-changed'); }
}
export function navBack() { if (navStack.back.length < 2) return; navStack.forward.push(navStack.back.pop()); goNav(navStack.back[navStack.back.length - 1]); }
export function navForward() { const k = navStack.forward.pop(); if (!k) return; navStack.back.push(k); goNav(k); }
export const canNav = () => ({ back: navStack.back.length > 1, forward: navStack.forward.length > 0 });

function pushRecent(project, path) {
  recent = [{ projectId: project.id, path, ts: Date.now() }, ...recent.filter((r) => !(r.projectId === project.id && r.path === path))].slice(0, 30);
  kv.set('recent', recent);
}
export const recentFiles = () => recent.filter((r) => getProject(r.projectId));

// ---------- Init ----------
export async function initEditor(container) {
  root = container;
  recent = await kv.get('recent', []);
  const pane = createPane();
  setActivePane(pane);
  root.dataset.split = 'column';
}

export async function restoreTabs() {
  const saved = await kv.get('openTabs', null);
  if (!saved?.length) return false;
  for (const s of saved) {
    const p = getProject(s.projectId);
    if (p && getRec(p, s.path)) await openFile(p, s.path, { focus: false, from: 'restore' });
  }
  return allTabs().length > 0;
}
const saveTabs = debounce(() => kv.set('openTabs', panes[0]?.tabs.filter((t) => t.kind === 'file').map((t) => ({ projectId: t.projectId, path: t.path })) || []), 500);
app.on('active-tab', saveTabs);

export function insertAtCursor(text) {
  let tab = activeTab();
  if (!tab?.view && lastFileTab?.view && allTabs().includes(lastFileTab)) { tab = lastFileTab; activate(tab, { focus: false }); }
  const v = tab?.view;
  if (!v) return;
  v.dispatch(v.state.replaceSelection(text));
  v.focus();
}

export function gotoLine(line) {
  const tab = activeTab();
  if (!tab?.view) return;
  const doc = tab.view.state.doc;
  const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
  tab.view.dispatch({ selection: EditorSelection.cursor(l.from), effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
  tab.view.focus();
}

export const shortcut = (k) => (isMac ? k.replace('Mod', '⌘').replace('Shift', '⇧').replace('Alt', '⌥').replace(/\+/g, '') : k.replace('Mod', 'Strg'));
