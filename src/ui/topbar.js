// Titelleiste: Bild 1 (Home › Workspace, ← → Verlauf) + Bild 2/4 (Panel-Schalter, Raster, Live, Blitz, Ausführen, Suche, Glocke).
import { h, frag } from '../core/util.js';
import { icon } from '../core/icons.js';
import { app } from '../core/store.js';
import { state as P, getProject } from '../projects/projects.js';
import { getSession } from '../collab/session.js';
import { activeTab, navBack, navForward, canNav, followPeer } from '../editor/editor.js';
import { prompt } from './dialog.js';
import { livePopover, gridMenu, quickOpen, recentMenu, notificationsMenu, settingsDialog } from './actions.js';

let el, refs = {};

const btn = (ic, title, onclick, cls = '') => h('button', { class: 'icon-btn tb ' + cls, title, 'aria-label': title, onclick }, frag(ic));

export function initTopbar(container) {
  el = container;
  refs.back = btn(icon.arrowLeft, 'Zurück (Alt+←)', navBack, 'nav');
  refs.fwd = btn(icon.arrowRight, 'Vor (Alt+→)', navForward, 'nav');
  refs.ws = h('button', { class: 'tb-workspace', title: 'Workspace umbenennen', onclick: async () => { const n = await prompt('Workspace umbenennen', { value: app.settings.workspaceName }); if (n) app.set('workspaceName', n); } });
  refs.left = btn(icon.panelLeft, 'Seitenleiste (Strg+B)', () => app.set('sidebarOpen', !app.settings.sidebarOpen), 'toggle');
  refs.bottom = btn(icon.panelBottom, 'Unteres Panel (Strg+J)', () => app.set('bottomOpen', !app.settings.bottomOpen), 'toggle');
  refs.right = btn(icon.panelRight, 'Vorschau-Panel', () => app.set('rightOpen', !app.settings.rightOpen), 'toggle hide-xs');
  refs.title = h('button', { class: 'tb-title', onclick: () => quickOpen() });
  refs.avatars = h('div', { class: 'tb-avatars' });
  refs.live = btn(icon.broadcast, 'Live-Zusammenarbeit', (e) => livePopover(e.currentTarget), 'live');
  refs.bolt = btn(icon.bolt, 'Smart-Modus: Vorschläge & Prüfungen', () => app.set('smartMode', !app.settings.smartMode), 'bolt');
  refs.bell = btn(icon.bell, 'Benachrichtigungen', (e) => notificationsMenu(e.currentTarget), 'bell hide-xs');
  refs.badge = h('span', { class: 'tb-badge', hidden: true });
  refs.bell.append(refs.badge);

  el.append(
    h('div', { class: 'tb-left' },
      h('button', { class: 'icon-btn tb home', title: 'Willkommen', onclick: () => app.emit('show-welcome') }, frag(icon.home)),
      h('span', { class: 'tb-chev' }, frag(icon.chevronRight)),
      refs.ws,
      refs.back, refs.fwd,
      btn(icon.clock, 'Zuletzt geöffnet', (e) => recentMenu(e.currentTarget), 'nav'),
      h('span', { class: 'tb-sep' }),
      refs.left, refs.bottom, refs.right,
      btn(icon.grid, 'Alle Aktionen', (e) => gridMenu(e.currentTarget), 'grid'),
    ),
    h('div', { class: 'tb-center' }, refs.title),
    h('div', { class: 'tb-right' },
      refs.avatars,
      refs.live,
      refs.bolt,
      btn(icon.play, 'Ausführen / Vorschau (Strg+Enter)', () => app.emit('run'), 'run'),
      btn(icon.search, 'Datei suchen (Strg+P)', () => quickOpen(), 'search'),
      refs.bell,
      btn(icon.settings, 'Einstellungen', settingsDialog, 'gear'),
    ),
  );

  const update = () => render();
  ['settings', 'nav-changed', 'active-tab', 'live-peers', 'live-changed', 'live-status', 'projects-changed', 'notification', 'notifications-read'].forEach((ev) => app.on(ev, update));
  render();

  // Window Controls Overlay (installierte PWA auf dem Desktop)
  const wco = navigator.windowControlsOverlay;
  if (wco) {
    const setWco = () => document.body.classList.toggle('wco', wco.visible);
    wco.addEventListener('geometrychange', setWco); setWco();
  }
}

function render() {
  const s = app.settings;
  refs.ws.textContent = s.workspaceName;
  const nav = canNav();
  refs.back.disabled = !nav.back; refs.fwd.disabled = !nav.forward;
  refs.left.replaceChildren(frag(s.sidebarOpen ? icon.panelLeftOn : icon.panelLeft));
  refs.bottom.replaceChildren(frag(s.bottomOpen ? icon.panelBottomOn : icon.panelBottom));
  refs.right.replaceChildren(frag(s.rightOpen ? icon.panelRightOn : icon.panelRight));
  refs.bolt.classList.toggle('on', s.smartMode);
  const tab = activeTab();
  const p = tab?.projectId ? getProject(tab.projectId) : P.list[0];
  refs.title.textContent = p ? p.name : 'Luna';
  // Live: Avatare aller Mitarbeitenden
  const sessions = P.list.map((x) => [x, getSession(x.id)]).filter(([, s2]) => s2);
  const peers = sessions.flatMap(([proj, s2]) => s2.peers().map((pe) => ({ ...pe, project: proj })));
  refs.live.classList.toggle('on', sessions.length > 0);
  refs.avatars.replaceChildren(...peers.slice(0, 5).map((pe) => h('button', {
    class: 'avatar sm', style: { background: pe.user.color }, title: `${pe.user.name}${pe.file ? ' – ' + pe.file : ''} (klicken zum Folgen)`,
    onclick: () => followPeer(pe.project, pe),
  }, (pe.user.name || '?')[0].toUpperCase())));
  const unread = app.notifications.filter((n) => !n.read).length;
  refs.badge.hidden = !unread;
  refs.badge.textContent = unread > 9 ? '9+' : unread;
}
