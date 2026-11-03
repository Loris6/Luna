// Aktionen & Dialoge: Repository hinzufügen, Live-Session, Einstellungen, Schnellsuche, Befehlspalette.
import { h, frag, fuzzyScore, basename, dirname, copyText, modKey } from '../core/util.js';
import { icon, fileIcon } from '../core/icons.js';
import { app, COLORS } from '../core/store.js';
import { keyboard } from '../core/keyboard.js';
import { state as P, createProject, allOpenableFiles, getProject } from '../projects/projects.js';
import { TEMPLATES } from '../projects/templates.js';
import { importGitHub } from '../projects/github.js';
import { openFolder, canPickDirectory, importFiles } from '../projects/folder.js';
import { startSession, stopSession, joinSession, getSession, shareLink, collabServerUrl } from '../collab/session.js';
import { openFile, activeTab, recentFiles, toggleSplit, gotoLine, followPeer } from '../editor/editor.js';
import { showMenu, closeMenus } from './menu.js';
import { openDialog, prompt, toast } from './dialog.js';

// ---------- Repository hinzufügen ----------
export function addRepositoryMenu(anchor) {
  showMenu(anchor, [
    { label: 'Neues Projekt …', icon: icon.newFolder, onClick: newProjectDialog },
    { label: canPickDirectory() ? 'Ordner öffnen …' : 'Ordner importieren …', icon: icon.folderOpen, onClick: () => openFolder().catch((e) => toast(e.message, { type: 'error' })) },
    { label: 'Von GitHub importieren …', icon: icon.github, onClick: githubDialog },
    { label: 'Live-Session beitreten …', icon: icon.broadcast, onClick: joinDialog },
  ], { className: 'add-menu' });
}

export function newProjectDialog() {
  const name = h('input', { class: 'input', placeholder: 'Projektname', value: 'Neues Projekt', autofocus: true });
  let tpl = 'web';
  const grid = h('div', { class: 'tpl-grid' });
  const render = () => grid.replaceChildren(...Object.entries(TEMPLATES).filter(([k]) => k !== 'demo').map(([k, t]) =>
    h('button', { type: 'button', class: 'tpl' + (tpl === k ? ' on' : ''), onclick: () => { tpl = k; render(); } }, h('strong', {}, t.name), h('span', { class: 'muted' }, `${Object.keys(t.files).length} Datei(en)`))));
  render();
  openDialog({
    title: 'Neues Projekt',
    body: [h('label', { class: 'field-label' }, 'Name'), name, h('label', { class: 'field-label' }, 'Vorlage'), grid],
    actions: [{ label: 'Abbrechen' }, { label: 'Erstellen', primary: true, submit: true, onClick: async () => {
      const n = name.value.trim();
      if (!n) return false;
      const p = await createProject({ name: n, template: tpl });
      const first = Object.keys(TEMPLATES[tpl].files).find((f) => /\.(html|js|ts|py|java)$/.test(f)) || Object.keys(TEMPLATES[tpl].files)[0];
      if (first) openFile(p, first);
      return true;
    } }],
  });
}

export function githubDialog() {
  const input = h('input', { class: 'input', placeholder: 'besitzer/repo oder https://github.com/…', autofocus: true, spellcheck: 'false' });
  const status = h('p', { class: 'muted small' }, 'Öffentliche Repos funktionieren direkt. Für private Repos oder mehr Anfragen ein Token in den Einstellungen hinterlegen.');
  const d = openDialog({
    title: 'Von GitHub importieren',
    body: [h('label', { class: 'field-label' }, 'Repository'), input, status],
    actions: [{ label: 'Abbrechen' }, { label: 'Importieren', primary: true, submit: true, onClick: async () => {
      if (!input.value.trim()) return false;
      status.textContent = 'Lade Repository-Infos …';
      try { await importGitHub(input.value); return true; }
      catch (e) { status.textContent = e.message; status.className = 'error small'; return false; }
    } }],
  });
  return d;
}

export function joinDialog() {
  const input = h('input', { class: 'input', placeholder: 'Link oder Code der Session', autofocus: true, spellcheck: 'false' });
  const msg = h('p', { class: 'muted small' }, 'Füge den Link ein, den du bekommen hast – oder nur den Code am Ende.');
  openDialog({
    title: 'Live-Session beitreten',
    body: [ensureNameField(), h('label', { class: 'field-label' }, 'Session'), input, msg],
    actions: [{ label: 'Abbrechen' }, { label: 'Beitreten', primary: true, submit: true, onClick: async () => {
      try { const s = await joinSession(input.value); app.emit('show-live', s.project); return true; }
      catch (e) { msg.textContent = e.message; msg.className = 'error small'; return false; }
    } }],
  });
}

function ensureNameField() {
  const name = h('input', { class: 'input', value: app.settings.userName, placeholder: 'Dein Name (sehen die anderen)', oninput: (e) => app.set('userName', e.target.value.trim()) });
  return [h('label', { class: 'field-label' }, 'Dein Name'), name];
}

// ---------- Live-Popover (Broadcast-Symbol) ----------
export function livePopover(anchor) {
  const tab = activeTab();
  const current = tab?.projectId ? getProject(tab.projectId) : P.list[0];
  const box = h('div', { class: 'live-pop' });
  const render = () => {
    const active = P.list.filter((p) => getSession(p.id));
    box.replaceChildren(h('div', { class: 'lp-title' }, frag(icon.broadcast), 'Live-Zusammenarbeit'));
    if (!app.settings.userName) {
      box.append(h('div', { class: 'lp-name' }, ensureNameField()));
    } else {
      box.append(h('div', { class: 'lp-me' }, h('span', { class: 'avatar', style: { background: app.settings.userColor } }, app.settings.userName[0].toUpperCase()), h('span', {}, app.settings.userName),
        h('span', { class: 'colors' }, COLORS.map((c) => h('button', { class: 'color' + (c === app.settings.userColor ? ' on' : ''), style: { background: c }, title: 'Farbe wählen', onclick: () => { app.set('userColor', c); render(); } })))));
    }
    for (const p of active) {
      const s = getSession(p.id);
      const peers = s.peers();
      const link = shareLink(s.room);
      box.append(h('div', { class: 'lp-session' },
        h('div', { class: 'lp-row' }, h('strong', {}, p.name), h('span', { class: 'lp-status ' + s.status }, s.status === 'online' ? 'verbunden' : s.status === 'local' ? 'nur dieses Gerät' : 'verbinde …')),
        h('div', { class: 'lp-link' }, h('input', { class: 'input', readonly: true, value: link, onclick: (e) => e.target.select() }),
          h('button', { class: 'btn', onclick: () => copyText(link).then(() => toast('Link kopiert – schick ihn an deine Mitarbeitenden.', { type: 'success' })) }, frag(icon.copy), 'Kopieren'),
          navigator.share ? h('button', { class: 'icon-btn', title: 'Teilen', onclick: () => navigator.share({ title: 'Luna Live-Session', url: link }).catch(() => {}) }, frag(icon.external)) : null),
        s.status === 'local' ? h('p', { class: 'muted small' }, `Kein Live-Server unter ${collabServerUrl()} erreichbar. Andere Tabs/Fenster auf diesem Gerät funktionieren trotzdem. Für andere Geräte „node server.js“ starten oder in den Einstellungen einen Server eintragen.`) : null,
        h('div', { class: 'lp-peers' }, peers.length ? peers.map((x) => h('button', { class: 'lp-peer', onclick: () => { closeMenus(0); followPeer(p, x); } },
          h('span', { class: 'avatar', style: { background: x.user.color } }, (x.user.name || '?')[0].toUpperCase()), h('span', {}, x.user.name), h('span', { class: 'muted small' }, x.file ? basename(x.file) : '–'))) : h('p', { class: 'muted small' }, 'Noch niemand sonst da. Teile den Link!')),
        h('button', { class: 'btn danger', onclick: async () => { await stopSession(p); closeMenus(0); } }, frag(icon.logout), p.liveRole === 'host' ? 'Session beenden' : 'Session verlassen')));
    }
    if (current && !getSession(current.id)) {
      box.append(h('button', { class: 'btn primary block', onclick: async () => { if (!app.settings.userName) app.set('userName', 'Gast ' + Math.floor(Math.random() * 90 + 10)); await startSession(current); render(); } }, frag(icon.broadcast), `„${current.name}“ live teilen`));
    }
    box.append(h('button', { class: 'btn block', onclick: () => { closeMenus(0); joinDialog(); } }, frag(icon.users), 'Session beitreten …'));
  };
  render();
  const offs = [app.on('live-peers', render), app.on('live-status', render), app.on('live-changed', render)];
  showMenu(anchor, [{ custom: box }], { align: 'end', className: 'live-menu', onClose: () => offs.forEach((f) => f()), noFocus: true });
}

// ---------- Einstellungen ----------
export function settingsDialog() {
  const s = app.settings;
  const field = (label, control, hint) => h('div', { class: 'set-row' }, h('div', {}, h('div', { class: 'set-label' }, label), hint ? h('div', { class: 'muted small' }, hint) : null), control);
  const select = (key, options) => h('select', { class: 'input', onchange: (e) => { const v = e.target.value; app.set(key, isNaN(+v) || v === '' ? v : +v); } }, options.map(([v, l]) => h('option', { value: v, selected: String(s[key]) === String(v) }, l)));
  const toggle = (key) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: s[key], onchange: (e) => app.set(key, e.target.checked) }), h('span'));
  const kbState = h('span', { class: 'muted small' }, keyboard.describe());
  const install = h('button', { class: 'btn', hidden: !window.__lunaInstall, onclick: () => app.emit('install-app') }, frag(icon.install), 'App installieren');
  openDialog({
    title: 'Einstellungen',
    wide: true,
    body: h('div', { class: 'settings' },
      h('h3', {}, 'Profil'),
      field('Name', h('input', { class: 'input', value: s.userName, placeholder: 'Wird anderen in Live-Sessions angezeigt', oninput: (e) => app.set('userName', e.target.value.trim()) })),
      field('Farbe', h('div', { class: 'colors' }, COLORS.map((c) => h('button', { type: 'button', class: 'color' + (c === s.userColor ? ' on' : ''), style: { background: c }, onclick: (e) => { app.set('userColor', c); e.target.parentNode.querySelectorAll('.color').forEach((b) => b.classList.toggle('on', b === e.target)); } }))), 'Farbe deines Cursors und Namensschilds.'),
      h('h3', {}, 'Editor'),
      field('Schriftgröße', select('fontSize', [11, 12, 13, 14, 15, 16, 18, 20].map((n) => [n, n + ' px']))),
      field('Tabulatorbreite', select('tabSize', [[2, '2 Leerzeichen'], [4, '4 Leerzeichen'], [8, '8 Leerzeichen']])),
      field('Zeilenumbruch', toggle('lineWrapping')),
      field('Smart-Modus', toggle('smartMode'), 'Vorschläge und Prüfungen (Blitz-Symbol).'),
      field('Vorschläge', select('completion', [['auto', 'Automatisch (nur mit Tastatur)'], ['on', 'Immer anzeigen'], ['off', 'Nie anzeigen']]), kbState),
      h('h3', {}, 'Verbindungen'),
      field('Live-Server', h('input', { class: 'input', value: s.collabServer, placeholder: collabServerUrl(), oninput: (e) => app.set('collabServer', e.target.value.trim()) }), 'WebSocket-Adresse für Sessions über mehrere Geräte. Leer = automatisch.'),
      field('GitHub-Token', h('input', { class: 'input', type: 'password', value: s.githubToken, placeholder: 'optional (ghp_…)', oninput: (e) => app.set('githubToken', e.target.value.trim()) }), 'Nur lokal gespeichert. Für private Repos & höhere Limits.'),
      h('h3', {}, 'App'),
      h('div', { class: 'set-actions' }, install, h('button', { class: 'btn', onclick: () => location.reload() }, frag(icon.refresh), 'Neu laden')),
    ),
    actions: [{ label: 'Fertig', primary: true }],
  });
}

// ---------- Schnell öffnen (Strg/⌘+P) ----------
export function quickOpen(initial = '') {
  const input = h('input', { class: 'qo-input', placeholder: 'Datei suchen … (> für Befehle, : für Zeile)', value: initial, autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'qo-list' });
  let items = [], sel = 0;
  const d = openDialog({ title: 'Schnell öffnen', body: [input, list], className: 'quick-open' });
  const choose = (i) => { const it = items[i]; if (!it) return; d.close(); it.run(); };
  const render = () => {
    const q = input.value;
    if (q.startsWith('>')) items = commandItems(q.slice(1).trim());
    else if (q.startsWith(':')) { const n = parseInt(q.slice(1), 10); items = n ? [{ label: `Gehe zu Zeile ${n}`, ic: icon.arrowRight, run: () => gotoLine(n) }] : []; }
    else {
      const all = allOpenableFiles();
      if (!q) {
        const rec = recentFiles().map((r) => all.find((f) => f.project.id === r.projectId && f.path === r.path)).filter(Boolean);
        items = (rec.length ? rec : all).slice(0, 50).map(fileItem);
      } else {
        items = all.map((f) => [fuzzyScore(q, f.path), f]).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]).slice(0, 60).map(([, f]) => fileItem(f));
      }
    }
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map((it, i) => h('button', { class: 'qo-item' + (i === sel ? ' sel' : ''), onclick: () => choose(i), onpointermove: () => { if (sel !== i) { sel = i; render(); } } },
      it.icon ? frag(it.icon) : frag(it.ic || icon.dot), h('span', { class: 'qo-label' }, it.label), it.detail ? h('span', { class: 'qo-detail' }, it.detail) : null, it.shortcut ? h('kbd', { class: 'kb-only' }, it.shortcut) : null)));
    if (!items.length) list.append(h('div', { class: 'muted pad' }, 'Keine Treffer.'));
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const fileItem = (f) => ({ label: basename(f.path), detail: `${f.project.name} / ${dirname(f.path)}`, icon: fileIcon(f.path), run: () => openFile(f.project, f.path) });
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
  });
  render();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

export const commandPalette = () => quickOpen('> ');

// Alle Befehle (für die Palette und das Raster-Menü)
export function commands() {
  return [
    { label: 'Datei öffnen …', ic: icon.search, shortcut: `${modKey}P`, run: () => quickOpen() },
    { label: 'In Dateien suchen', ic: icon.sparkSearch, shortcut: `${modKey}⇧F`, run: () => app.emit('show-search') },
    { label: 'Neues Projekt …', ic: icon.newFolder, run: newProjectDialog },
    { label: 'Ordner öffnen …', ic: icon.folderOpen, run: () => openFolder().catch((e) => toast(e.message, { type: 'error' })) },
    { label: 'Von GitHub importieren …', ic: icon.github, run: githubDialog },
    { label: 'Live-Session beitreten …', ic: icon.users, run: joinDialog },
    { label: 'Live-Session starten/teilen', ic: icon.broadcast, run: () => app.emit('show-live') },
    { label: 'Ausführen / Vorschau', ic: icon.play, shortcut: `${modKey}↵`, run: () => app.emit('run') },
    { label: 'Ansicht teilen', ic: icon.splitDown, shortcut: `${modKey}\\`, run: () => toggleSplit() },
    { label: 'Geteilt: nebeneinander', ic: icon.split, run: () => toggleSplit('row') },
    { label: 'Geteilt: untereinander', ic: icon.splitDown, run: () => toggleSplit('column') },
    { label: 'Seitenleiste ein/aus', ic: icon.panelLeft, shortcut: `${modKey}B`, run: () => app.set('sidebarOpen', !app.settings.sidebarOpen) },
    { label: 'Unteres Panel ein/aus', ic: icon.panelBottom, shortcut: `${modKey}J`, run: () => app.set('bottomOpen', !app.settings.bottomOpen) },
    { label: 'Vorschau-Panel ein/aus', ic: icon.panelRight, run: () => app.set('rightOpen', !app.settings.rightOpen) },
    { label: 'Smart-Modus umschalten', ic: icon.bolt, run: () => app.set('smartMode', !app.settings.smartMode) },
    { label: 'Dokumentation durchsuchen', ic: icon.docs, run: () => app.emit('show-docs', { focus: true }) },
    { label: 'Gehe zu Zeile …', ic: icon.arrowRight, shortcut: `${modKey}G`, run: () => app.emit('goto-line') },
    { label: 'Einstellungen', ic: icon.settings, shortcut: `${modKey},`, run: settingsDialog },
    { label: 'Willkommen', ic: icon.moon, run: () => app.emit('show-welcome') },
  ];
}
function commandItems(q) {
  return commands().map((c) => [fuzzyScore(q, c.label), c]).filter(([s]) => s >= 0).sort((a, b) => (q ? b[0] - a[0] : 0)).map(([, c]) => c);
}

export function gridMenu(anchor) {
  showMenu(anchor, commands().map((c) => ({ label: c.label, icon: c.ic, shortcut: c.shortcut, onClick: c.run })), { className: 'grid-menu' });
}

export async function gotoLineDialog() {
  const tab = activeTab();
  if (!tab?.view) return;
  const v = await prompt('Gehe zu Zeile', { placeholder: `1 – ${tab.view.state.doc.lines}`, ok: 'Springen' });
  const n = parseInt(v, 10);
  if (n) gotoLine(n);
}

export function recentMenu(anchor) {
  const items = recentFiles().slice(0, 15).map((r) => {
    const p = getProject(r.projectId);
    return { label: basename(r.path), hint: `${p.name} / ${dirname(r.path)}`, icon: fileIcon(r.path), onClick: () => openFile(p, r.path) };
  });
  showMenu(anchor, items.length ? [{ section: 'Zuletzt geöffnet' }, ...items] : [{ section: 'Noch keine Dateien geöffnet' }], { className: 'recent-menu' });
}

export function notificationsMenu(anchor) {
  const list = app.notifications;
  list.forEach((n) => { n.read = true; });
  app.emit('notifications-read');
  const box = h('div', { class: 'notif-list' },
    list.length ? list.map((n) => h('div', { class: 'notif ' + n.type }, frag(n.type === 'error' ? icon.error : icon.info), h('div', {}, h('div', {}, n.text), h('div', { class: 'muted small' }, new Date(n.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })))))
      : h('p', { class: 'muted pad' }, 'Keine Benachrichtigungen.'));
  showMenu(anchor, [{ section: 'Benachrichtigungen' }, { custom: box }], { align: 'end', className: 'notif-menu', noFocus: true });
}

export { importFiles };
