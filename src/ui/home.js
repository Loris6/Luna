// Dashboard: Übersicht, Projekte, Verbindungen, Webhooks, Einstellungen.
// Desktop: Navigation links. Handy: Footer (iOS-Stil auf Apple-Geräten, normaler Footer auf Android).
import { h, frag, basename, dirname, timeAgo, copyText, debounce } from '../core/util.js';
import { icon, fileIcon } from '../core/icons.js';
import { app, COLORS } from '../core/store.js';
import { auth } from '../core/auth.js';
import { sync } from '../core/sync.js';
import { secure } from '../core/secure.js';
import { platform, biometricLabel } from '../core/platform.js';
import { keyboard } from '../core/keyboard.js';
import { kv } from '../core/db.js';
import { state as P, filesSync } from '../projects/projects.js';
import { githubUser, listUserRepos, importGitHub, pushChanges } from '../projects/github.js';
import { openFolder } from '../projects/folder.js';
import { listWebhooks, createWebhook, deleteWebhook, regenerateSecret, sendWebhook, isDiscordUrl } from '../core/webhooks.js';
import { getSession, collabServerUrl } from '../collab/session.js';
import { openFile, recentFiles } from '../editor/editor.js';
import { openRepoMenu } from './sidebar.js';
import { newProjectDialog, githubDialog, joinDialog } from './actions.js';
import { openDialog, confirm, toast, prompt } from './dialog.js';
import { DEVICES } from './preview.js';

const ROUTES = [
  { id: 'overview', label: 'Übersicht', ic: icon.homeLine },
  { id: 'projects', label: 'Projekte', ic: icon.folderLine },
  { id: 'connections', label: 'Verbindungen', ic: icon.plug },
  { id: 'webhooks', label: 'Webhooks', ic: icon.webhook },
  { id: 'settings', label: 'Einstellungen', ic: icon.gear },
];

export const home = { route: 'overview', el: null, back: null };

export function initHome(el, { go }) {
  home.el = el;
  home.go = go;
  const visible = () => document.body.classList.contains('view-home');
  const rerender = debounce(() => { if (visible() && !document.querySelector('.overlay, .lock-screen')) render(); }, 120);
  const when = (routes) => () => { if (routes.includes(home.route)) rerender(); };
  app.on('projects-changed', when(['overview', 'projects']));
  app.on('tree-changed', when(['overview', 'projects']));
  app.on('live-changed', when(['projects']));
  app.on('webhooks-changed', when(['webhooks', 'overview', 'connections']));
  // Sync-Status nur an Ort und Stelle aktualisieren (Seite nicht neu aufbauen)
  app.on('sync-status', () => { for (const el of home.el.querySelectorAll('[data-sync]')) el.replaceWith(syncPill()); });
  auth.on('change', rerender);
}

export function showRoute(route) {
  home.route = route;
  render();
  home.el.querySelector('.home-scroll')?.scrollTo(0, 0);
}

function avatar(user, size = 32) {
  const letter = (user?.name || user?.email || '?').trim()[0]?.toUpperCase() || '?';
  if (user?.picture) return h('img', { class: 'avatar img', src: user.picture, alt: '', width: size, height: size, referrerpolicy: 'no-referrer', style: { width: size + 'px', height: size + 'px' } });
  return h('span', { class: 'avatar', style: { background: app.settings.userColor, width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px' } }, letter);
}

function render() {
  const route = ROUTES.find((r) => r.id === home.route) || ROUTES[0];
  const user = auth.user;
  const nav = h('aside', { class: 'home-nav' },
    h('div', { class: 'hn-brand' }, h('img', { src: 'icons/logo-mark-64.png', alt: '', class: 'luna-mark' }), h('span', {}, 'Luna')),
    h('nav', { class: 'hn-items' }, ROUTES.map((r) => h('button', { class: 'hn-item' + (r.id === route.id ? ' active' : ''), onclick: () => showRoute(r.id) }, frag(r.ic), h('span', {}, r.label),
      r.id === 'webhooks' ? h('span', { class: 'hn-count', 'data-webhooks': '' }) : null))),
    h('div', { class: 'hn-sep' }),
    h('button', { class: 'hn-item', onclick: () => home.go('ide') }, frag(icon.code), h('span', {}, 'Editor öffnen')),
    h('a', { class: 'hn-item', href: 'docs.html', target: '_blank', rel: 'noopener' }, frag(icon.book2), h('span', {}, 'Dokumentation'), frag(icon.external)),
    h('div', { class: 'grow' }),
    h('button', { class: 'hn-user', onclick: () => showRoute('settings') }, avatar(user, 32), h('span', { class: 'hn-user-text' }, h('strong', {}, user?.name || 'Konto'), h('span', {}, user?.email || '')), frag(icon.chevronRight)),
  );
  const isSub = home.route !== 'overview' && home.route !== 'settings';
  const header = h('header', { class: 'home-header' },
    isSub ? h('button', { class: 'hh-back', onclick: () => showRoute('overview') }, frag(icon.chevronRight), h('span', {}, 'Übersicht')) : null,
    h('div', { class: 'hh-row' },
      h('h1', {}, route.label),
      h('div', { class: 'hh-actions' }, headerActions(route.id))));
  const scroll = h('div', { class: 'home-scroll' }, h('div', { class: 'home-content' }, PAGES[route.id]()));
  home.el.replaceChildren(h('div', { class: 'dash' }, nav, h('main', { class: 'home-main' }, header, scroll)));
  // Anzahl Webhooks im Menü
  listWebhooks().then((l) => { const c = home.el.querySelector('[data-webhooks]'); if (c) c.textContent = l.length || ''; });
}

function headerActions(id) {
  if (id === 'overview' || id === 'projects') return [
    h('button', { class: 'btn primary', onclick: newProjectDialog }, frag(icon.plus), h('span', { class: 'hide-sm' }, 'Neues Projekt')),
  ];
  if (id === 'webhooks') return [h('button', { class: 'btn primary', onclick: () => webhookDialog() }, frag(icon.plus), h('span', { class: 'hide-sm' }, 'Neuer Webhook'))];
  return [];
}

// ---------- Bausteine ----------
const card = (title, actions, ...children) => h('section', { class: 'card' },
  title ? h('header', { class: 'card-head' }, h('h2', {}, title), actions ? h('div', { class: 'card-actions' }, actions) : null) : null,
  ...children);
const list = (...rows) => h('div', { class: 'list' }, ...rows);
function row({ ic, title, sub, right, onclick, danger, chevron = !!onclick, cls = '' }) {
  return h(onclick ? 'button' : 'div', { class: 'row-item' + (danger ? ' danger' : '') + (cls ? ' ' + cls : ''), onclick, type: onclick ? 'button' : null },
    ic ? h('span', { class: 'ri-ic' }, typeof ic === 'string' ? frag(ic) : ic) : null,
    h('span', { class: 'ri-text' }, h('span', { class: 'ri-title' }, title), sub ? h('span', { class: 'ri-sub' }, sub) : null),
    right ? h('span', { class: 'ri-right' }, right) : null,
    chevron ? h('span', { class: 'ri-chev' }, frag(icon.chevronRight)) : null);
}
const nFiles = (n) => `${n} ${n === 1 ? 'Datei' : 'Dateien'}`;
const pill = (text, kind = '') => h('span', { class: 'pill-status ' + kind }, h('i'), text);
const sourceLabel = (p) => ({ github: 'GitHub', folder: 'Ordner', upload: 'Import', live: 'Live-Session', local: 'Lokal' }[p.source] || 'Lokal');
function projectIcon(p) {
  if (p.source === 'github') return h('span', { class: 'proj-ic gh' }, frag(icon.github));
  return h('span', { class: 'proj-ic', style: { background: p.color || '#3e63dd' } }, (p.name.match(/[A-Za-z0-9]/)?.[0] || '?').toUpperCase());
}
function projectStats(p) {
  const files = filesSync(p);
  if (!files) return { files: 0, scripts: 0, lines: 0, updated: p.mtime || p.createdAt };
  let n = 0, scripts = 0, lines = 0, updated = p.mtime || p.createdAt || 0;
  for (const r of files.values()) {
    if (r.placeholder) continue;
    n++;
    if (/\.luna$/i.test(r.path)) { scripts++; lines += (r.content || '').split('\n').length; }
    if (r.mtime > updated) updated = r.mtime;
  }
  return { files: n, scripts, lines, updated };
}
function openProject(p) {
  const files = filesSync(p);
  const first = files && ([...files.keys()].find((k) => /(^|\/)main\.luna$/.test(k)) || [...files.keys()].find((k) => /\.luna$/.test(k)) || [...files.keys()].find((k) => !files.get(k).placeholder));
  home.go('ide');
  if (first) openFile(p, first);
  app.emit('reveal-file', { projectId: p.id, path: first || '', force: true });
}

function syncPill() {
  const s = sync.status;
  let el;
  if (!auth.serverMode) el = pill('Nur dieses Gerät', 'muted');
  else if (s === 'ok') el = pill('Synchronisiert', 'ok');
  else if (s === 'syncing') el = pill('Synchronisiere …', 'busy');
  else if (s === 'offline') el = pill('Offline', 'warn');
  else if (s === 'error') el = pill('Fehler beim Sync', 'bad');
  else el = pill('Bereit', 'muted');
  el.dataset.sync = '';
  if (s === 'error' && sync.error) el.title = sync.error;
  return el;
}

function greeting() {
  const hr = new Date().getHours();
  return hr < 11 ? 'Guten Morgen' : hr < 18 ? 'Guten Tag' : 'Guten Abend';
}

// ---------- Seiten ----------
const PAGES = {
  overview() {
    const user = auth.user;
    const projects = P.list;
    const totals = projects.reduce((a, p) => { const s = projectStats(p); a.scripts += s.scripts; a.lines += s.lines; return a; }, { scripts: 0, lines: 0 });
    const conn = connectionStates();
    const active = Object.values(conn).filter(Boolean).length;
    const recent = recentFiles().slice(0, 6);
    const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    return [
      h('div', { class: 'ov-hello' },
        h('div', {}, h('h2', {}, `${greeting()}, ${(user?.name || '').split(' ')[0] || 'willkommen'}`), h('p', {}, today)),
        h('div', { class: 'ov-hello-actions' }, syncPill(), h('button', { class: 'btn', onclick: () => home.go('ide') }, frag(icon.code), 'Editor öffnen'))),
      h('div', { class: 'stats' },
        stat('Projekte', projects.length, `${projects.filter((p) => p.source === 'github').length} von GitHub`, () => showRoute('projects')),
        stat('Luna-Scripts', totals.scripts, `${totals.lines.toLocaleString('de-DE')} Zeilen`),
        stat('Synchronisierung', auth.serverMode ? (sync.lastSync ? timeAgo(sync.lastSync) : '—') : 'Lokal', sync.describe()),
        stat('Verbindungen', `${active} / 4`, 'GitHub, Google, Discord, Server', () => showRoute('connections'))),
      h('div', { class: 'grid-2' },
        card('Projekte', h('button', { class: 'link-btn', onclick: () => showRoute('projects') }, 'Alle anzeigen'),
          projects.length ? list(...projects.slice(0, 5).map((p) => { const s = projectStats(p); return row({ ic: projectIcon(p), title: p.name, sub: `${sourceLabel(p)} · ${p.branch} · ${nFiles(s.files)}`, right: h('span', { class: 'muted small' }, timeAgo(s.updated)), onclick: () => openProject(p) }); }))
            : empty('Noch keine Projekte', 'Lege ein Projekt an oder importiere ein GitHub-Repository.', h('button', { class: 'btn primary', onclick: newProjectDialog }, 'Neues Projekt'))),
        card('Zuletzt bearbeitet', null,
          recent.length ? list(...recent.map((r) => { const p = P.list.find((x) => x.id === r.projectId); return row({ ic: frag(fileIcon(r.path)), title: basename(r.path), sub: `${p?.name || ''}${dirname(r.path) ? ' / ' + dirname(r.path) : ''}`, right: h('span', { class: 'muted small' }, timeAgo(r.ts)), onclick: () => { home.go('ide'); openFile(p, r.path); } }); }))
            : empty('Noch nichts geöffnet', 'Öffne eine Datei im Editor – sie erscheint dann hier.'))),
      h('div', { class: 'grid-2' },
        card('Verbindungen', h('button', { class: 'link-btn', onclick: () => showRoute('connections') }, 'Verwalten'),
          list(
            row({ ic: icon.github, title: 'GitHub', sub: conn.github ? 'Verbunden' : 'Repositories importieren und pushen', right: conn.github ? pill('Aktiv', 'ok') : null, onclick: () => showRoute('connections') }),
            row({ ic: icon.google, title: 'Google-Konto', sub: auth.user?.email, right: conn.google ? pill('Aktiv', 'ok') : null, onclick: () => showRoute('connections') }),
            row({ ic: icon.discord, title: 'Discord', sub: 'Nachrichten über Webhooks senden', right: conn.discord ? pill('Aktiv', 'ok') : null, onclick: () => showRoute('webhooks') }),
            row({ ic: icon.server, title: 'Luna-Server', sub: auth.serverMode ? 'Konto & Sync zwischen Geräten' : 'Nicht verbunden – nur dieses Gerät', right: conn.server ? pill('Online', 'ok') : pill('Aus', 'muted'), onclick: () => showRoute('connections') }))),
        card('Luna lernen', h('a', { class: 'link-btn', href: 'docs.html', target: '_blank', rel: 'noopener' }, 'Dokumentation'),
          list(
            row({ ic: icon.book2, title: 'Variablen: local, let, const', sub: 'Was wo sichtbar und änderbar ist', onclick: () => openDocs('handbuch/variablen') }),
            row({ ic: icon.book2, title: 'Funktionen mit end)', sub: 'function … end) und local function', onclick: () => openDocs('handbuch/funktionen') }),
            row({ ic: icon.book2, title: '2D-Oberfläche', sub: 'create("Button") und :ConnectTo', onclick: () => openDocs('handbuch/oberflaeche') }),
            row({ ic: icon.book2, title: 'Schleifen & wait()', sub: 'while wait(1) do … end, Countdown', onclick: () => openDocs('handbuch/schleifen') })))),
    ];
  },

  projects() {
    const q = h('input', { class: 'input search', type: 'search', placeholder: 'Projekte suchen …', value: home.query || '' });
    const body = h('div');
    const draw = () => {
      home.query = q.value;
      const term = q.value.trim().toLowerCase();
      const items = P.list.filter((p) => !term || p.name.toLowerCase().includes(term));
      body.replaceChildren(items.length
        ? h('div', { class: 'table' },
          h('div', { class: 'tr th' }, h('span', {}, 'Name'), h('span', {}, 'Quelle'), h('span', {}, 'Branch'), h('span', { class: 'num' }, 'Dateien'), h('span', {}, 'Geändert'), h('span')),
          items.map((p) => {
            const s = projectStats(p);
            return h('div', { class: 'tr', onclick: (e) => { if (!e.target.closest('.tr-menu')) openProject(p); } },
              h('span', { class: 'td-name' }, projectIcon(p), h('span', {}, h('strong', {}, p.name), h('small', {}, `${sourceLabel(p)} · ${p.branch} · ${nFiles(s.files)}`))),
              h('span', { class: 'td-hide' }, sourceLabel(p), getSession(p.id) ? h('span', { class: 'tag live' }, 'Live') : null),
              h('span', { class: 'td-hide mono' }, p.branch),
              h('span', { class: 'td-hide num' }, s.files),
              h('span', { class: 'td-hide muted' }, timeAgo(s.updated)),
              h('button', { class: 'icon-btn sm tr-menu', title: 'Aktionen', onclick: (e) => { e.stopPropagation(); openRepoMenu(p, e.currentTarget); } }, frag(icon.more)));
          }))
        : empty(term ? 'Keine Treffer' : 'Noch keine Projekte', term ? 'Versuch einen anderen Suchbegriff.' : 'Lege ein Projekt an, öffne einen Ordner oder importiere von GitHub.'));
    };
    q.addEventListener('input', draw);
    draw();
    return [
      h('div', { class: 'toolbar' }, q,
        h('button', { class: 'btn', onclick: () => openFolder().catch((e) => toast(e.message, { type: 'error' })) }, frag(icon.folderOpen), h('span', { class: 'hide-sm' }, 'Ordner öffnen')),
        h('button', { class: 'btn', onclick: githubDialog }, frag(icon.github), h('span', { class: 'hide-sm' }, 'Von GitHub')),
        h('button', { class: 'btn', onclick: joinDialog }, frag(icon.broadcast), h('span', { class: 'hide-sm' }, 'Live beitreten'))),
      body,
    ];
  },

  connections() {
    const c = connectionStates();
    const gh = h('div');
    const ghRefresh = async () => {
      const cached = (await kv.get('connections', {})).github;
      if (!app.settings.githubToken) {
        gh.replaceChildren(row({ ic: icon.github, title: 'GitHub', sub: 'Verbinde dein Konto, um private Repositories zu importieren und Änderungen zu pushen.', right: h('button', { class: 'btn primary sm', onclick: githubConnectDialog }, 'Verbinden') }));
        return;
      }
      gh.replaceChildren(row({ ic: cached?.avatar ? h('img', { class: 'avatar img', src: cached.avatar, width: 28, height: 28, alt: '' }) : icon.github, title: 'GitHub', sub: cached?.login ? `Verbunden als @${cached.login}` : 'Verbunden (Token)', right: pill('Aktiv', 'ok') }),
        h('div', { class: 'conn-actions' },
          h('button', { class: 'btn sm', onclick: repoPicker }, frag(icon.download), 'Repository importieren'),
          h('button', { class: 'btn sm', onclick: pushDialog }, frag(icon.upload), 'Änderungen pushen'),
          h('button', { class: 'btn sm danger', onclick: async () => { if (await confirm('GitHub trennen?', 'Der Token wird von diesem Konto entfernt. Importierte Projekte bleiben erhalten.', { ok: 'Trennen', danger: true })) { app.set('githubToken', ''); const con = await kv.get('connections', {}); delete con.github; await kv.set('connections', con); ghRefresh(); } } }, 'Trennen')));
    };
    ghRefresh();
    const serverUrl = auth.serverBase() || location.origin + location.pathname.replace(/[^/]*$/, '');
    return [
      card('Konto & Synchronisierung', null, list(
        row({ ic: avatar(auth.user, 30), title: auth.user?.name || '', sub: auth.user?.email }),
        row({ ic: icon.google, title: 'Google', sub: c.google ? 'Mit Google angemeldet' : 'Melde dich mit Google an – gleiche E-Mail-Adresse = gleiches Konto.', right: c.google ? pill('Verknüpft', 'ok') : h('button', { class: 'btn sm', onclick: async () => { if (await confirm('Mit Google anmelden?', 'Du wirst abgemeldet und kannst dich danach mit Google anmelden. Projekte bleiben in deinem Konto.', { ok: 'Weiter' })) { await auth.logout(); location.reload(); } } }, 'Verknüpfen') }),
        row({ ic: icon.server, title: 'Luna-Server', sub: auth.server ? serverUrl : 'Nicht erreichbar – Konto und Projekte nur auf diesem Gerät', right: auth.server ? pill(auth.serverMode ? 'Sync aktiv' : 'Erreichbar', auth.serverMode ? 'ok' : 'warn') : pill('Offline', 'muted'),
          onclick: async () => { const url = await prompt('Adresse des Luna-Servers', { value: auth.serverBase(), placeholder: 'leer = diese Seite', label: 'Für Konto-Sync und Live-Sessions zwischen Geräten.' }); if (url !== null) { auth.setServerBase(url || ''); await auth.detectServer(); render(); } } }),
        auth.serverMode ? row({ ic: icon.sync, title: 'Jetzt synchronisieren', sub: sync.describe() + (sync.lastSync ? ` · ${timeAgo(sync.lastSync)}` : ''), onclick: () => sync.now() }) : null)),
      card('Code & Repositories', null, gh),
      card('Nachrichten & Automatisierung', null, list(
        row({ ic: icon.discord, title: 'Discord', sub: 'Nachrichten aus Luna-Scripts in einen Discord-Kanal senden', right: h('button', { class: 'btn sm', onclick: () => webhookDialog({ kind: 'discord' }) }, 'Hinzufügen') }),
        row({ ic: icon.webhook, title: 'Webhooks', sub: 'Eigene Ziele mit geschütztem API-Secret', onclick: () => showRoute('webhooks') }),
        row({ ic: icon.broadcast, title: 'Live-Zusammenarbeit', sub: collabServerUrl(), right: pill(auth.server ? 'Bereit' : 'Nur dieses Gerät', auth.server ? 'ok' : 'muted') }))),
    ];
  },

  webhooks() {
    const box = h('div', { class: 'wh-list' }, h('div', { class: 'loading-row' }, 'Lade …'));
    listWebhooks().then((hooks) => {
      if (!hooks.length) {
        box.replaceChildren(empty('Noch keine Webhooks', 'Webhooks schicken Nachrichten aus deinen Luna-Scripts an Discord oder eigene Server. Das API-Secret ist mit Passwort oder Gerätesperre geschützt.', h('button', { class: 'btn primary', onclick: () => webhookDialog() }, frag(icon.plus), 'Neuer Webhook')));
        return;
      }
      box.replaceChildren(...hooks.map(webhookCard));
    });
    return [
      h('p', { class: 'page-intro' }, 'Senden aus Luna: ', h('code', {}, 'import Webhook'), ' und ', h('code', {}, 'Webhook.send("Name", "Text")'), '. Secrets siehst du nur nach Bestätigung mit ', secure.config.device ? secure.config.device.label : 'deinem Schutz-Passwort', '.'),
      box,
    ];
  },

  settings() { return settingsPage(); },
};

function stat(label, value, sub, onclick) {
  return h(onclick ? 'button' : 'div', { class: 'stat', onclick }, h('span', { class: 'stat-label' }, label), h('strong', { class: 'stat-value' }, String(value)), h('span', { class: 'stat-sub' }, sub));
}
function empty(title, text, action) {
  return h('div', { class: 'empty' }, h('strong', {}, title), h('p', {}, text), action || null);
}
function connectionStates() {
  return {
    github: !!app.settings.githubToken,
    google: !!auth.user?.providers?.includes('google'),
    discord: !!home.discord,
    server: !!auth.server && auth.serverMode,
  };
}
listWebhooks().then((l) => { home.discord = l.some((w) => w.kind === 'discord'); }).catch(() => {});
app.on('webhooks-changed', () => listWebhooks().then((l) => { home.discord = l.some((w) => w.kind === 'discord'); }));

export function openDocs(path = '') {
  window.open('docs.html' + (path ? '#/' + path : ''), '_blank', 'noopener');
}

// ---------- GitHub ----------
function githubConnectDialog() {
  const token = h('input', { class: 'input', type: 'password', placeholder: 'ghp_… oder github_pat_…', autocomplete: 'off', spellcheck: 'false' });
  const msg = h('p', { class: 'muted small' });
  openDialog({
    title: 'GitHub verbinden',
    body: [
      h('p', { class: 'dlg-text' }, 'Erstelle einen persönlichen Zugriffstoken mit Zugriff auf deine Repositories (Rechte: „repo“) und füge ihn hier ein. Er wird nur in deinem Konto gespeichert.'),
      h('a', { class: 'btn sm', href: 'https://github.com/settings/tokens/new?scopes=repo&description=Luna%20IDE', target: '_blank', rel: 'noopener' }, frag(icon.external), 'Token auf GitHub erstellen'),
      h('label', { class: 'field-label' }, 'Token'), token, msg,
    ],
    actions: [{ label: 'Abbrechen' }, { label: 'Verbinden', primary: true, submit: true, onClick: async () => {
      if (!token.value.trim()) return false;
      const old = app.settings.githubToken;
      app.set('githubToken', token.value.trim());
      try {
        const u = await githubUser();
        const con = await kv.get('connections', {});
        con.github = { login: u.login, name: u.name, avatar: u.avatar_url, connected: Date.now() };
        await kv.set('connections', con);
        await kv.set('meta.mtime', Date.now()); sync.markMeta();
        toast(`Mit GitHub verbunden: @${u.login}`, { type: 'success' });
        render();
        return true;
      } catch (e) { app.set('githubToken', old); msg.textContent = e.message; msg.className = 'error small'; return false; }
    } }],
  });
}

async function repoPicker() {
  const listEl = h('div', { class: 'repo-pick' }, h('p', { class: 'muted' }, 'Lade Repositories …'));
  const d = openDialog({ title: 'Repository importieren', body: listEl, wide: true });
  try {
    const repos = await listUserRepos();
    listEl.replaceChildren(...repos.map((r) => h('button', { class: 'repo-pick-row', onclick: async () => { d.close(); try { await importGitHub(r.full_name); toast(`„${r.full_name}“ wird importiert …`); } catch (e) { toast(e.message, { type: 'error' }); } } },
      frag(icon.github), h('span', {}, h('strong', {}, r.full_name), h('small', {}, r.description || (r.private ? 'Privat' : 'Öffentlich'))), r.private ? h('span', { class: 'tag' }, 'privat') : null)));
  } catch (e) { listEl.replaceChildren(h('p', { class: 'error' }, e.message)); }
}

function pushDialog() {
  const repos = P.list.filter((p) => p.source === 'github');
  if (!repos.length) { toast('Importiere zuerst ein GitHub-Repository.'); return; }
  const select = h('select', { class: 'input' }, repos.map((p) => h('option', { value: p.id }, `${p.owner}/${p.repo} (${p.branch})`)));
  const msgIn = h('input', { class: 'input', value: 'Änderungen aus Luna' });
  openDialog({
    title: 'Änderungen pushen',
    body: [h('label', { class: 'field-label' }, 'Repository'), select, h('label', { class: 'field-label' }, 'Commit-Nachricht'), msgIn],
    actions: [{ label: 'Abbrechen' }, { label: 'Pushen', primary: true, submit: true, onClick: async () => {
      try { const n = await pushChanges(P.list.find((p) => p.id === select.value), msgIn.value.trim() || 'Änderungen aus Luna'); if (!n) toast('Keine Änderungen zum Pushen.'); return true; }
      catch (e) { toast(e.message, { type: 'error' }); return false; }
    } }],
  });
}

// ---------- Webhooks ----------
function mask(s, keep = 6) { return s ? s.slice(0, keep) + '•'.repeat(Math.max(8, Math.min(22, s.length - keep))) : '—'; }
function maskUrl(u) {
  if (!u) return 'Kein Ziel (nur Secret)';
  try { const x = new URL(u); return `${x.host}${x.pathname.split('/').slice(0, 3).join('/')}/…`; } catch { return u.slice(0, 24) + '…'; }
}

function webhookCard(w) {
  const secretEl = h('code', { class: 'wh-secret' }, mask(w.secret));
  let shown = false, timer;
  const reveal = async () => {
    if (shown) { secretEl.textContent = mask(w.secret); shown = false; showBtn.textContent = 'Anzeigen'; return; }
    if (!(await secure.confirmSecret(`Secret von „${w.name}“ anzeigen`))) return;
    secretEl.textContent = w.secret; shown = true; showBtn.textContent = 'Verbergen';
    clearTimeout(timer); timer = setTimeout(() => { if (shown) reveal(); }, 30000);
  };
  const showBtn = h('button', { class: 'btn sm', onclick: reveal }, 'Anzeigen');
  return h('article', { class: 'card wh' },
    h('header', { class: 'wh-head' },
      h('span', { class: 'ri-ic' }, frag(w.kind === 'discord' ? icon.discord : icon.webhook)),
      h('div', { class: 'wh-title' }, h('strong', {}, w.name), h('small', {}, maskUrl(w.url))),
      h('span', { class: 'tag' }, w.kind === 'discord' ? 'Discord' : 'HTTP')),
    h('div', { class: 'wh-field' }, h('span', { class: 'wh-label' }, 'API-Secret'), secretEl,
      h('div', { class: 'wh-btns' }, showBtn,
        h('button', { class: 'btn sm', onclick: async () => { if (await secure.confirmSecret(`Secret von „${w.name}“ kopieren`)) { await copyText(w.secret); toast('Secret kopiert.', { type: 'success' }); } } }, frag(icon.copy), 'Kopieren'))),
    h('div', { class: 'wh-field' }, h('span', { class: 'wh-label' }, 'In Luna'), h('code', { class: 'wh-usage' }, `import Webhook\nWebhook.send("${w.name}", "Hallo!")`)),
    h('footer', { class: 'wh-foot' },
      h('span', { class: 'muted small' }, w.lastUsed ? `Zuletzt benutzt ${timeAgo(w.lastUsed)}` : `Erstellt ${timeAgo(w.created)}`),
      h('div', { class: 'grow' }),
      w.url ? h('button', { class: 'btn sm', onclick: async () => { try { await sendWebhook(w, 'Test aus Luna ✓'); toast('Test gesendet.', { type: 'success' }); } catch (e) { toast(e.message, { type: 'error' }); } } }, 'Testen') : null,
      h('button', { class: 'btn sm', onclick: async () => { if (await secure.confirmSecret('Neues Secret erzeugen') && await confirm('Neues Secret erzeugen?', 'Das alte Secret funktioniert danach nicht mehr.', { ok: 'Neu erzeugen' })) await regenerateSecret(w.id); } }, 'Neu erzeugen'),
      h('button', { class: 'btn sm danger', onclick: async () => { if (await secure.confirmSecret(`Webhook „${w.name}“ löschen`) && await confirm('Webhook löschen?', `„${w.name}“ wird gelöscht.`, { ok: 'Löschen', danger: true })) await deleteWebhook(w.id); } }, 'Löschen')));
}

export function webhookDialog({ kind = '' } = {}) {
  const name = h('input', { class: 'input', placeholder: kind === 'discord' ? 'z. B. Server-Ankündigungen' : 'z. B. MeinServer', autofocus: true });
  const url = h('input', { class: 'input', type: 'url', placeholder: kind === 'discord' ? 'https://discord.com/api/webhooks/…' : 'https://… (optional)', spellcheck: 'false' });
  const msg = h('p', { class: 'muted small' }, kind === 'discord' ? 'In Discord: Kanal-Einstellungen → Integrationen → Webhooks → Webhook-URL kopieren.' : 'Luna sendet JSON und signiert es mit dem Secret (Header X-Luna-Signature).');
  openDialog({
    title: kind === 'discord' ? 'Discord verbinden' : 'Neuer Webhook',
    body: [h('label', { class: 'field-label' }, 'Name'), name, h('label', { class: 'field-label' }, 'Ziel-Adresse'), url, msg],
    actions: [{ label: 'Abbrechen' }, { label: 'Erstellen', primary: true, submit: true, onClick: async () => {
      try {
        if (kind === 'discord' && !isDiscordUrl(url.value.trim())) throw new Error('Bitte eine Discord-Webhook-URL einfügen.');
        const w = await createWebhook({ name: name.value, url: url.value.trim(), kind });
        if (!secure.hasProtection) await secure.setupDialog({ title: 'Secret schützen', text: `Der Webhook „${w.name}“ hat ein API-Secret. Lege fest, wie du dich bestätigst, bevor es angezeigt wird: ${biometricLabel()} oder ein Passwort.` });
        toast(`Webhook „${w.name}“ erstellt.`, { type: 'success' });
        showRoute('webhooks');
        return true;
      } catch (e) { msg.textContent = e.message; msg.className = 'error small'; return false; }
    } }],
  });
}

// ---------- Einstellungen ----------
function settingsPage() {
  const s = app.settings;
  const user = auth.user;
  const out = h('div', { class: 'settings-page' });
  const section = (title, footer, ...rows) => h('section', { class: 'set-group' }, h('h3', {}, title), h('div', { class: 'set-list' }, ...rows.flat().filter(Boolean)), footer ? h('p', { class: 'set-foot' }, footer) : null);
  const line = (label, control, sub) => h('div', { class: 'set-line' }, h('div', { class: 'sl-text' }, h('span', {}, label), sub ? h('small', {}, sub) : null), h('div', { class: 'sl-ctrl' }, control));
  const toggle = (checked, onchange) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('span'));
  const select = (value, options, onchange) => h('select', { class: 'input sel', onchange: (e) => onchange(e.target.value) }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  const action = (label, onclick, danger) => h('button', { class: 'set-action' + (danger ? ' danger' : ''), onclick }, label);

  const draw = async () => {
    const devOk = await secure.deviceAvailable();
    const cfg = secure.config;
    out.replaceChildren(
      section('Konto', auth.serverMode ? 'Dein Konto und deine Projekte sind auf allen Geräten verfügbar, auf denen du dich anmeldest.' : 'Ohne Luna-Server gilt das Konto nur auf diesem Gerät.',
        h('div', { class: 'set-line account' }, avatar(user, 44), h('div', { class: 'sl-text' }, h('strong', {}, user?.name || ''), h('small', {}, user?.email || '')),
          h('button', { class: 'btn sm', onclick: async () => { const n = await prompt('Name ändern', { value: user?.name || '' }); if (n) { await auth.rename(n); app.set('userName', n); render(); } } }, 'Bearbeiten')),
        line('Anmeldung', h('span', { class: 'muted' }, (user?.providers || []).map((p) => (p === 'google' ? 'Google' : 'E-Mail')).join(' & ') || 'E-Mail')),
        line('Synchronisierung', h('span', { class: 'sl-inline' }, syncPill(), auth.serverMode ? h('button', { class: 'btn sm', onclick: () => sync.now() }, 'Jetzt') : null)),
        action('Abmelden', async () => { if (await confirm('Abmelden?', 'Du kannst dich jederzeit wieder anmelden.', { ok: 'Abmelden' })) { await auth.logout(); location.reload(); } }, true)),
      section('Sicherheit', `Webhook-Secrets werden nur nach Bestätigung angezeigt. „Passwort vergessen?“ – mit der richtigen Konto-E-Mail kannst du ein neues festlegen.`,
        line('App-Passwort', cfg.password ? h('span', { class: 'sl-inline' }, h('button', { class: 'btn sm', onclick: changePassword }, 'Ändern'), h('button', { class: 'btn sm danger', onclick: async () => { if (await secure.verify({ reason: 'App-Passwort entfernen' })) { secure.removePassword(); draw(); } } }, 'Entfernen'))
          : h('button', { class: 'btn sm', onclick: changePassword }, 'Festlegen'), cfg.password ? 'Eingerichtet' : 'Nicht eingerichtet'),
        line(biometricLabel(), devOk ? (cfg.device ? h('button', { class: 'btn sm danger', onclick: async () => { if (await secure.verify({ reason: `${biometricLabel()} entfernen` })) { secure.removeDevice(); draw(); } } }, 'Entfernen')
          : h('button', { class: 'btn sm', onclick: async () => { try { await secure.setupDevice(); toast(`${biometricLabel()} eingerichtet.`, { type: 'success' }); draw(); } catch (e) { if (e.name !== 'NotAllowedError') toast(e.message, { type: 'error' }); } } }, 'Einrichten'))
          : h('span', { class: 'muted small' }, 'Nicht verfügbar'), cfg.device ? 'Eingerichtet – geräteabhängig' : 'Geräteabhängig'),
        line('App beim Öffnen sperren', toggle(cfg.lockApp && secure.hasProtection, async (v) => {
          if (v && !secure.hasProtection && !(await secure.setupDialog({ title: 'App-Sperre einrichten' }))) return draw();
          const c = secure.config; c.lockApp = v; secure.save(c); draw();
        }), secure.hasProtection ? 'Fragt beim Start nach Passwort oder ' + biometricLabel() : 'Erst Passwort oder Gerätesperre einrichten'),
        line('Automatisch sperren', select(cfg.lockAfterMin, [[0, 'Sofort'], [1, 'Nach 1 Minute'], [5, 'Nach 5 Minuten'], [15, 'Nach 15 Minuten'], [60, 'Nach 1 Stunde'], [-1, 'Nie']], (v) => { const c = secure.config; c.lockAfterMin = Number(v); secure.save(c); }), 'Wenn die App im Hintergrund war')),
      section('Editor', null,
        line('Schriftgröße', select(s.fontSize, [11, 12, 13, 14, 15, 16, 18, 20].map((n) => [n, n + ' px']), (v) => app.set('fontSize', Number(v)))),
        line('Tabulatorbreite', select(s.tabSize, [[2, '2 Leerzeichen'], [4, '4 Leerzeichen']], (v) => app.set('tabSize', Number(v)))),
        line('Zeilenumbruch', toggle(s.lineWrapping, (v) => app.set('lineWrapping', v))),
        line('Smart-Modus', toggle(s.smartMode, (v) => app.set('smartMode', v)), 'Vorschläge und Prüfungen'),
        line('Vorschläge', select(s.completion, [['auto', 'Automatisch (nur mit Tastatur)'], ['on', 'Immer'], ['off', 'Nie']], (v) => app.set('completion', v)), keyboard.describe())),
      section('Vorschau', 'Gerät, das die Vorschau beim Ausführen zeigt. Wechseln geht jederzeit oben in der Vorschau.',
        line('Standard-Gerät', select(s.previewDevice, DEVICES.map((d) => [d.id, d.group === 'fit' ? d.name : `${d.group} – ${d.name}`]), (v) => app.set('previewDevice', v)))),
      section('Live-Zusammenarbeit', null,
        line('Farbe', h('div', { class: 'colors' }, COLORS.map((c) => h('button', { type: 'button', class: 'color' + (c === s.userColor ? ' on' : ''), style: { background: c }, onclick: () => { app.set('userColor', c); draw(); } }))))),
      section('App', null,
        line('Version', h('span', { class: 'muted' }, 'Luna ' + (window.__lunaVersion || '1.1'))),
        window.__lunaInstall ? action('App installieren', () => app.emit('install-app')) : null,
        platform.ios && !platform.standalone ? line('Als App installieren', h('span', { class: 'muted small' }, 'Teilen ⎋ → „Zum Home-Bildschirm“')) : null,
        action('Neu laden', () => location.reload())),
    );
  };
  draw();
  return out;
}

async function changePassword() {
  const c = secure.config;
  if (c.password && !(await secure.verify({ reason: 'Aktuelles App-Passwort bestätigen' }))) return;
  const a = h('input', { class: 'input', type: 'password', placeholder: 'Neues Passwort', autocomplete: 'new-password', autofocus: true });
  const b = h('input', { class: 'input', type: 'password', placeholder: 'Wiederholen', autocomplete: 'new-password' });
  const msg = h('p', { class: 'muted small' }, 'Mindestens 4 Zeichen. Schützt die App und deine Webhook-Secrets.');
  openDialog({
    title: c.password ? 'App-Passwort ändern' : 'App-Passwort festlegen',
    body: [a, b, msg],
    actions: [{ label: 'Abbrechen' }, { label: 'Speichern', primary: true, submit: true, onClick: async () => {
      if (a.value !== b.value) { msg.textContent = 'Die Passwörter stimmen nicht überein.'; msg.className = 'error small'; return false; }
      try { await secure.setPassword(a.value); toast('App-Passwort gespeichert.', { type: 'success' }); render(); return true; }
      catch (e) { msg.textContent = e.message; msg.className = 'error small'; return false; }
    } }],
  });
}

export { render as renderHome };
