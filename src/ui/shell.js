// Ansichten (Dashboard ↔ Editor) und der Footer fürs Handy: iOS-Tab-Bar auf Apple-Geräten, normaler Footer auf Android.
import { h, frag } from '../core/util.js';
import { icon } from '../core/icons.js';
import { app } from '../core/store.js';
import { platform } from '../core/platform.js';
import { keyboard } from '../core/keyboard.js';
import { panes } from '../editor/editor.js';
import { home, initHome, showRoute } from './home.js';

export const shell = { view: 'ide', footer: null };
const isNarrow = () => innerWidth < 760;

const TABS = [
  { id: 'home', label: 'Übersicht', ic: icon.homeLine, on: icon.homeFill },
  { id: 'files', label: 'Dateien', ic: icon.folderLine, on: icon.folder },
  { id: 'editor', label: 'Editor', ic: icon.code },
  { id: 'preview', label: 'Vorschau', ic: icon.eye },
  { id: 'settings', label: 'Einstellungen', ic: icon.gear },
];

export function go(view, route) {
  shell.view = view;
  document.body.classList.toggle('view-home', view === 'home');
  document.body.classList.toggle('view-ide', view === 'ide');
  if (view === 'home') showRoute(route || home.route || 'overview');
  else requestAnimationFrame(() => panes.forEach((p) => p.active?.view?.requestMeasure()));
  renderFooter();
}

function activeTab() {
  if (shell.view === 'home') return home.route === 'settings' ? 'settings' : 'home';
  if (isNarrow() && app.settings.sidebarOpen) return 'files';
  if (isNarrow() && app.settings.rightOpen) return 'preview';
  return 'editor';
}

function tap(id) {
  if (id === 'home') return go('home', 'overview');
  if (id === 'settings') return go('home', 'settings');
  go('ide');
  if (id === 'files') { app.set('rightOpen', false); app.set('sidebarOpen', true); }
  if (id === 'editor') { app.set('sidebarOpen', false); app.set('rightOpen', false); }
  if (id === 'preview') { app.set('sidebarOpen', false); app.set('rightOpen', true); }
  renderFooter();
}

export function renderFooter() {
  const f = shell.footer;
  if (!f) return;
  const active = activeTab();
  f.replaceChildren(...TABS.map((t) => h('button', {
    class: 'ft-item' + (t.id === active ? ' active' : ''), type: 'button', 'aria-label': t.label, 'aria-current': t.id === active ? 'page' : null,
    onclick: () => tap(t.id),
  }, h('span', { class: 'ft-ic' }, frag(t.id === active && t.on ? t.on : t.ic)), h('span', { class: 'ft-label' }, t.label))));
}

export function initShell({ homeEl, footerEl }) {
  shell.footer = footerEl;
  footerEl.className = 'app-footer ' + (platform.ios ? 'ios' : 'android');
  initHome(homeEl, { go });
  app.on('go', ({ view, route }) => go(view, route));
  app.on('settings', ({ key }) => { if (key === 'sidebarOpen' || key === 'rightOpen') renderFooter(); });
  app.on('sidebar-file-opened', () => renderFooter());
  keyboard.on('virtual-keyboard', (v) => document.body.classList.toggle('vk-open', v));
  addEventListener('resize', renderFooter);
  renderFooter();
}
