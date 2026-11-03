// Luna – Einstiegspunkt.
import { app } from './core/store.js';
import { h, $, isMac } from './core/util.js';
import { keyboard } from './core/keyboard.js';
import { loadProjects, getProject, flushNow, state as P, createProject } from './projects/projects.js';
import './projects/github.js';
import './projects/folder.js';
import { resumeSessions, joinSession } from './collab/session.js';
import {
  initEditor, openFile, openDoc, openWelcome, restoreTabs, toggleSplit, navBack, navForward, activeTab, closeTab, insertAtCursor, panes,
} from './editor/editor.js';
import { initSidebar, showPanel, fileMenu, renameItem } from './ui/sidebar.js';
import { initTopbar } from './ui/topbar.js';
import { initPanels } from './ui/panels.js';
import { renderWelcome, initKeyBar } from './ui/welcome.js';
import { quickOpen, commandPalette, settingsDialog, gotoLineDialog, livePopover, joinDialog } from './ui/actions.js';
import { showMenu } from './ui/menu.js';
import { toast } from './ui/dialog.js';
import { icon } from './core/icons.js';

async function boot() {
  await app.init();
  keyboard.setMode(app.settings.completion);

  // ---------- Layout ----------
  const topbar = h('header', { class: 'topbar' });
  const sidebar = h('aside', { class: 'sidebar' });
  const editorArea = h('div', { class: 'editor-area' });
  const bottom = h('section', { class: 'bottom-panel' });
  const right = h('aside', { class: 'right-panel' });
  const scrim = h('div', { class: 'scrim', onclick: () => app.set('sidebarOpen', false) });
  const main = h('main', { class: 'workbench' }, sidebar, scrim, h('div', { class: 'center' }, editorArea, bottom), right);
  const shell = $('#app');
  shell.replaceChildren(topbar, main);
  applyLayout();

  await loadProjects();
  await initEditor(editorArea);
  initSidebar(sidebar);
  initTopbar(topbar);
  initPanels(bottom, right);
  initKeyBar();

  app.on('render-welcome', (el) => renderWelcome(el));
  app.on('show-welcome', () => openWelcome());
  app.on('open-doc', (id) => { openDoc(id); if (isNarrow()) app.set('sidebarOpen', false); });
  app.on('show-docs', (opts = {}) => { app.set('sidebarOpen', true); showPanel('docs', opts); });
  app.on('show-search', () => { app.set('sidebarOpen', true); showPanel('search', { focus: true }); });
  app.on('show-live', () => livePopover($('.icon-btn.live')));
  app.on('insert-text', (t) => insertAtCursor(t));
  app.on('goto-line', gotoLineDialog);
  app.on('file-menu', ({ project, path, anchor }) => fileMenu(project, path, anchor));
  app.on('open-split', async ({ project, path }) => { if (panes.length < 2) toggleSplit('column'); await openFile(project, path, { pane: panes[1] }); });
  app.on('sidebar-file-opened', () => { if (isNarrow()) app.set('sidebarOpen', false); });
  app.on('save-request', () => { flushNow(); toast('Gespeichert – Luna speichert automatisch.', { type: 'success', timeout: 1500 }); });
  app.on('cycle-completion', () => {
    const order = ['auto', 'on', 'off'];
    const next = order[(order.indexOf(app.settings.completion) + 1) % 3];
    app.set('completion', next);
    toast(keyboard.describe());
  });
  app.on('tab-menu', ({ tab, x, y }) => showMenu({ x, y }, [
    { label: 'Schließen', icon: icon.close, onClick: () => closeTab(tab) },
    { label: 'Andere schließen', onClick: () => tab.pane.tabs.filter((t) => t !== tab).forEach(closeTab) },
    { label: 'Alle schließen', onClick: () => [...tab.pane.tabs].forEach(closeTab) },
    tab.kind === 'file' ? '-' : null,
    tab.kind === 'file' ? { label: 'Im geteilten Bereich öffnen', icon: icon.splitDown, onClick: () => app.emit('open-split', { project: getProject(tab.projectId), path: tab.path }) } : null,
    tab.kind === 'file' ? { label: 'Im Dateibaum zeigen', icon: icon.folderOpen, onClick: () => app.emit('reveal-file', { projectId: tab.projectId, path: tab.path, force: true }) } : null,
  ]));
  app.on('settings', ({ key }) => {
    if (key === 'completion') keyboard.setMode(app.settings.completion);
    if (['sidebarOpen', 'bottomOpen', 'rightOpen', 'sidebarWidth', 'bottomHeight', 'rightWidth'].includes(key)) applyLayout();
  });
  keyboard.on('change', () => document.body.classList.toggle('has-keyboard', keyboard.present));
  document.body.classList.toggle('has-keyboard', keyboard.present);

  // ---------- Inhalte wiederherstellen ----------
  const restored = await restoreTabs();
  if (!restored) {
    const demo = P.list.find((p) => p.name === 'Luna Demo') || P.list[0];
    if (demo && !isNarrow()) {
      await openFile(demo, 'src/app.js', { focus: false });
      if (innerWidth > 1100) { toggleSplit('column'); await openFile(demo, 'src/rpc-node.ts', { pane: panes[1], focus: false }); }
    } else openWelcome();
  }
  if (isNarrow() && !restored) app.set('sidebarOpen', false);

  await resumeSessions();
  await handleHash();
  addEventListener('hashchange', handleHash);
  initShortcuts();
  initPwa();
  document.body.classList.add('ready');
}

const isNarrow = () => innerWidth < 760;

function applyLayout() {
  const s = app.settings;
  const root = document.documentElement;
  root.style.setProperty('--sidebar-w', s.sidebarWidth + 'px');
  root.style.setProperty('--bottom-h', s.bottomHeight + 'px');
  root.style.setProperty('--right-w', s.rightWidth + 'px');
  document.body.classList.toggle('sidebar-open', s.sidebarOpen);
  document.body.classList.toggle('bottom-open', s.bottomOpen);
  document.body.classList.toggle('right-open', s.rightOpen);
  requestAnimationFrame(() => panes.forEach((p) => p.active?.view?.requestMeasure()));
}

async function handleHash() {
  if (location.hash === '#new' || location.hash === '#join') {
    const which = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    const { newProjectDialog } = await import('./ui/actions.js');
    return which === '#new' ? newProjectDialog() : joinDialog();
  }
  const m = /live=([a-z0-9]+)/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (!app.settings.userName) {
    joinDialog();
    requestAnimationFrame(() => { const inputs = document.querySelectorAll('.dialog input'); if (inputs[1]) inputs[1].value = m[1]; });
    return;
  }
  try {
    const s = await joinSession(m[1]);
    app.emit('show-live', s.project);
  } catch (e) { toast(e.message, { type: 'error' }); }
}

function initShortcuts() {
  addEventListener('keydown', (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && !e.shiftKey && k === 'p') { e.preventDefault(); quickOpen(); }
    else if (mod && e.shiftKey && k === 'p') { e.preventDefault(); commandPalette(); }
    else if (mod && e.shiftKey && k === 'f') { e.preventDefault(); app.emit('show-search'); }
    else if (mod && !e.shiftKey && k === 'b') { e.preventDefault(); app.set('sidebarOpen', !app.settings.sidebarOpen); }
    else if (mod && !e.shiftKey && k === 'j') { e.preventDefault(); app.set('bottomOpen', !app.settings.bottomOpen); }
    else if (mod && e.key === '\\') { e.preventDefault(); toggleSplit(); }
    else if (mod && e.key === 'Enter') { e.preventDefault(); app.emit('run'); }
    else if (mod && !e.shiftKey && k === 'g') { e.preventDefault(); gotoLineDialog(); }
    else if (mod && e.key === ',') { e.preventDefault(); settingsDialog(); }
    else if (mod && k === 's') { e.preventDefault(); app.emit('save-request'); }
    else if (e.altKey && !mod && e.key === 'ArrowLeft') { e.preventDefault(); navBack(); }
    else if (e.altKey && !mod && e.key === 'ArrowRight') { e.preventDefault(); navForward(); }
    else if (e.altKey && k === 'w') { e.preventDefault(); const t = activeTab(); if (t) closeTab(t); }
    else if (e.key === 'F2') {
      const row = document.querySelector('.row.selected');
      const t = activeTab();
      if (row && t?.kind === 'file') { e.preventDefault(); renameItem(getProject(t.projectId), t.path); }
    }
  });
}

// ---------- PWA ----------
function initPwa() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Neue Version von Luna verfügbar.', { timeout: 10000, action: { label: 'Neu laden', onClick: () => { nw.postMessage('skipWaiting'); location.reload(); } } });
          }
        });
      });
    }).catch((e) => console.warn('Service Worker nicht registriert', e));
  }
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__lunaInstall = e;
  });
  app.on('install-app', async () => {
    const e = window.__lunaInstall;
    if (!e) { toast('Installation über das Browser-Menü („Zum Startbildschirm“ / „App installieren“).'); return; }
    e.prompt();
    await e.userChoice;
    window.__lunaInstall = null;
  });
  // Dateien aus dem Betriebssystem öffnen (installierte PWA, file_handlers)
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      let p = P.list.find((x) => x.name === 'Geöffnete Dateien');
      if (!p) p = await createProject({ name: 'Geöffnete Dateien', files: {} });
      const { importFiles } = await import('./projects/folder.js');
      const files = await Promise.all(params.files.map((fh) => fh.getFile()));
      await importFiles(p, files);
      await openFile(p, files[0].name);
    });
  }
  addEventListener('online', () => toast('Wieder online.', { type: 'success' }));
  addEventListener('offline', () => toast('Offline – Luna funktioniert weiter, Änderungen bleiben lokal.'));
}

boot().catch((e) => {
  console.error(e);
  document.body.append(h('pre', { class: 'boot-error' }, 'Luna konnte nicht starten:\n' + (e.stack || e.message)));
});
