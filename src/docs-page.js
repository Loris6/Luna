// Luna-Dokumentation als eigene Seite (docs.html): Handbuch, Referenz, Suche und ausführbare Beispiele mit Geräte-Vorschau.
import { highlightCode, classHighlighter } from '../vendor/core.js';
import { h, frag, copyText } from './core/util.js';
import { icon } from './core/icons.js';
import { applyPlatformClasses } from './core/platform.js';
import { SETS, GUIDE, KIND_LABEL, entriesFor, getEntry, searchDocs } from './docs/registry.js';
import { lunaLanguage } from './luna/language.js';
import { LunaRuntime } from './luna/runtime.js';
import { devicePreview } from './ui/preview.js';

applyPlatformClasses();

const KIND_STYLE = {
  class: ['C', '#2a7deb'], function: ['ƒ', '#a35ad6'], method: ['m', '#c94f6d'], property: ['f', '#c98a2c'], constant: ['c', '#1d9a8f'],
  keyword: ['k', '#5d6370'], namespace: ['N', '#a07a2c'], module: ['M', '#a07a2c'], snippet: ['{}', '#5d6370'], event: ['bolt', '#c98a2c'],
};
function kindIcon(kind) {
  const [letter, color] = KIND_STYLE[kind] || KIND_STYLE.keyword;
  const el = h('span', { class: 'kind-ic', style: { background: color } });
  if (letter === 'bolt') el.append(frag(icon.bolt)); else { el.textContent = letter; if (letter.length > 1) el.classList.add('small'); }
  return el;
}

const entries = entriesFor('luna');
const GROUPS = [
  { id: 'schluesselwoerter', title: 'Schlüsselwörter', test: (e) => e.kind === 'keyword' || (e.kind === 'constant' && !e.owner) },
  { id: 'funktionen', title: 'Eingebaute Funktionen', test: (e) => e.kind === 'function' && !e.owner },
  { id: 'bibliotheken', title: 'Bibliotheken', test: (e) => e.kind === 'module' || ['Html', 'discord', 'Webhook', 'Http', 'Storage'].includes(e.owner) && e.kind !== 'class' },
  { id: 'elemente', title: '2D-Elemente', test: (e) => e.kind === 'class' },
  { id: 'eigenschaften', title: 'Eigenschaften & Ereignisse', test: (e) => e.owner === 'Element' || e.owner === 'Event' || e.owner === 'Connection' },
  { id: 'standard', title: 'math, string, table', test: (e) => ['math', 'string', 'table'].includes(e.owner) || e.kind === 'namespace' },
  { id: 'schnipsel', title: 'Schnipsel', test: (e) => e.kind === 'snippet' },
];
const groupOf = (e) => GROUPS.find((g) => g.test(e));
const fullName = (e) => (e.owner && !['Html', 'Element', 'Event', 'Connection'].includes(e.owner) ? `${e.owner}.${e.label}` : e.label);
const cleanSnippet = (s) => s.replace(/\$\{([^}]*)\}/g, '$1');

// ---------- Code mit Einfärbung, Kopieren und Ausführen ----------
function code(src, { runnable = true } = {}) {
  const pre = h('pre', { class: 'code' });
  const out = h('code', {});
  try {
    highlightCode(src, lunaLanguage.parser.parse(src), classHighlighter,
      (text, classes) => out.append(classes ? h('span', { class: classes }, text) : text),
      () => out.append('\n'));
  } catch { out.textContent = src; }
  pre.append(out);
  const result = h('div', { class: 'run-result', hidden: true });
  let rt = null;
  const run = async () => {
    rt?.stop();
    result.hidden = false;
    const log = h('div', { class: 'run-log' });
    const host = h('div', { class: 'luna-stage-host' });
    const screen = h('div', { class: 'luna-screen' }, h('div', { class: 'panel-empty' }, 'Keine Oberfläche – Ausgaben siehe Konsole.'));
    const preview = devicePreview(screen, { device: localStorage.getItem('luna.docs.device') || 'ph-iphone15', onChange: (id) => { try { localStorage.setItem('luna.docs.device', id); } catch {} } });
    const status = h('span', { class: 'run-status' }, 'läuft');
    result.replaceChildren(
      h('div', { class: 'run-head' }, h('strong', {}, 'Ergebnis'), status, h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: () => rt?.stop() }, 'Stopp'), h('button', { class: 'icon-btn sm', title: 'Schließen', onclick: () => { rt?.stop(); result.hidden = true; } }, frag(icon.close))),
      h('div', { class: 'run-body' }, h('div', { class: 'run-console' }, h('div', { class: 'run-label' }, 'Konsole'), log), h('div', { class: 'run-preview' }, preview.el)));
    rt = new LunaRuntime({
      out: (level, text, loc) => { log.append(h('div', { class: 'rl ' + level }, h('span', {}, text), loc?.line ? h('small', {}, `Zeile ${loc.line}`) : null)); log.scrollTop = log.scrollHeight; },
      stageHost: host,
      projectId: 'docs',
      onStatus: (s) => { status.textContent = s; status.className = 'run-status ' + (s === 'läuft' || s === 'wartet auf Ereignisse' ? 'on' : ''); },
      onStage: () => { screen.replaceChildren(host); result.classList.add('has-ui'); },
    });
    await rt.run([{ path: 'beispiel.luna', source: src }]);
    if (!log.children.length) log.append(h('div', { class: 'rl muted' }, '(keine Ausgabe)'));
  };
  return h('div', { class: 'code-block' },
    h('div', { class: 'code-bar' }, h('span', {}, 'Luna'),
      h('button', { class: 'cb-btn', onclick: async () => { await copyText(src); flash('Kopiert'); } }, frag(icon.copy), 'Kopieren'),
      runnable ? h('button', { class: 'cb-btn run', onclick: run }, frag(icon.play), 'Ausführen') : null),
    pre, result);
}

let flashEl;
function flash(text) {
  flashEl?.remove();
  flashEl = h('div', { class: 'flash' }, text);
  document.body.append(flashEl);
  setTimeout(() => flashEl?.remove(), 1400);
}

// ---------- Seiten ----------
function pageStart() {
  return [
    h('p', { class: 'eyebrow' }, 'Dokumentation'),
    h('h1', {}, 'Luna'),
    h('p', { class: 'lead' }, 'Luna ist eine Programmiersprache für alle – sehr ähnlich zu Luau aus Roblox, aber nicht nur für Roblox. Hier findest du das Handbuch zum Lernen und die Referenz zum Nachschlagen. Jedes Beispiel kannst du direkt ausführen und in verschiedenen Geräten ansehen.'),
    h('div', { class: 'tiles' },
      tile('Handbuch', 'Schritt für Schritt: Variablen, Funktionen, Bedingungen, Schleifen …', '#/handbuch/start', icon.book2),
      tile('Referenz', `${entries.length} Einträge: alle Schlüsselwörter, Funktionen und Bibliotheken.`, '#/referenz', icon.docs),
      tile('2D-Oberfläche', 'Buttons, Texte und Schalter mit import Html.', '#/handbuch/oberflaeche', icon.layout),
      tile('Webhooks & Discord', 'Nachrichten aus deinen Scripts senden.', '#/handbuch/webhooks', icon.webhook)),
    h('h2', {}, 'Auf einen Blick'),
    code('import Html\n\nlocal geheim = "nur in dieser Datei"\nlet count = 0          -- überall änderbar\nconst MAX = 10         -- überall lesbar, nicht änderbar\n\nfunction sayHello()    -- Funktionen enden mit end)\n  print("Hello")\nend)\n\nlet button = create("Button")\nbutton.innerText = "Klick mich"\nbutton.click:ConnectTo(function()\n  count += 1\n  if count >= MAX then\n    button.innerText = "Fertig!"\n  else\n    button.innerText = "Klicks: {count}"\n  end\nend)\n\nsayHello()'),
    h('h2', {}, 'Die wichtigsten Regeln'),
    h('ul', { class: 'rules' },
      h('li', {}, h('code', {}, 'local'), ' gilt nur in der Datei, ', h('code', {}, 'let'), ' ist überall änderbar, ', h('code', {}, 'const'), ' überall lesbar, aber nicht änderbar.'),
      h('li', {}, 'Funktionen enden immer mit ', h('code', {}, 'end)'), '.'),
      h('li', {}, h('code', {}, 'if'), ', ', h('code', {}, 'else'), ', ', h('code', {}, 'else if'), ' und Schleifen enden mit ', h('code', {}, 'end'), ' – ohne Klammer. ', h('code', {}, 'else if'), ' braucht ein eigenes ', h('code', {}, 'end'), '.'),
      h('li', {}, 'Bibliotheken holst du mit ', h('code', {}, 'import Html'), ', ', h('code', {}, 'import discord'), ', ', h('code', {}, 'import Webhook'), ' …')),
  ];
}
function tile(title, text, href, ic) {
  return h('a', { class: 'tile', href }, h('span', { class: 'tile-ic' }, frag(ic)), h('strong', {}, title), h('span', {}, text));
}

function pageGuide(id) {
  const i = GUIDE.findIndex((g) => g.id === id);
  const g = GUIDE[i] || GUIDE[0];
  const rel = entries.filter((e) => e.ref === g.id && e.kind !== 'snippet').slice(0, 12);
  return {
    toc: [g.title, rel.length ? 'Passende Einträge' : null].filter(Boolean),
    body: [
      h('p', { class: 'eyebrow' }, `Handbuch · ${i + 1} von ${GUIDE.length}`),
      h('h1', {}, g.title),
      h('p', { class: 'lead' }, g.text),
      g.code ? code(g.code) : null,
      rel.length ? [h('h2', { id: 'passende-eintraege' }, 'Passende Einträge'), h('div', { class: 'ref-grid' }, rel.map(refCard))] : null,
      pager(GUIDE[i - 1] && { title: GUIDE[i - 1].title, href: '#/handbuch/' + GUIDE[i - 1].id }, GUIDE[i + 1] && { title: GUIDE[i + 1].title, href: '#/handbuch/' + GUIDE[i + 1].id }),
    ],
  };
}

function refCard(e) {
  return h('a', { class: 'ref-card', href: '#/referenz/' + encodeURIComponent(e.id) }, kindIcon(e.kind), h('span', {}, h('strong', {}, fullName(e)), h('small', {}, e.desc)));
}

function pageRefIndex() {
  return [
    h('p', { class: 'eyebrow' }, 'Referenz'),
    h('h1', {}, 'Alles auf einen Blick'),
    h('p', { class: 'lead' }, 'Jeder Eintrag erklärt kurz, was er macht – mit Syntax und Beispiel.'),
    GROUPS.map((g) => {
      const list = entries.filter((e) => groupOf(e) === g);
      return list.length ? [h('h2', { id: g.id }, g.title), h('div', { class: 'ref-grid' }, list.map(refCard))] : null;
    }),
  ];
}

function pageEntry(id) {
  const e = getEntry(id);
  if (!e) return [h('h1', {}, 'Nicht gefunden'), h('p', {}, 'Diesen Eintrag gibt es nicht.'), h('a', { href: '#/referenz', class: 'btn' }, 'Zur Referenz')];
  const g = groupOf(e);
  const siblings = entries.filter((x) => x !== e && x.owner && x.owner === e.owner).slice(0, 12);
  const guide = GUIDE.find((x) => x.id === e.ref);
  return [
    h('p', { class: 'eyebrow' }, h('a', { href: '#/referenz' }, 'Referenz'), ' · ', g ? h('a', { href: '#/referenz' }, g.title) : null),
    h('div', { class: 'entry-head' }, kindIcon(e.kind), h('h1', { class: 'mono-title' }, fullName(e))),
    h('div', { class: 'badges' }, h('span', { class: 'badge' }, KIND_LABEL[e.kind] || e.kind), e.owner ? h('span', { class: 'badge' }, e.owner) : null, h('span', { class: 'badge brand' }, 'Luna')),
    h('p', { class: 'lead' }, e.desc),
    h('h2', {}, e.kind === 'snippet' ? 'Einfügen' : 'Syntax'),
    code(e.kind === 'snippet' ? cleanSnippet(e.sig) : e.sig, { runnable: false }),
    e.example ? [h('h2', {}, 'Beispiel'), code(e.example)] : null,
    guide ? h('a', { class: 'guide-link', href: '#/handbuch/' + guide.id }, frag(icon.book2), h('span', {}, h('small', {}, 'Im Handbuch'), h('strong', {}, guide.title)), frag(icon.chevronRight)) : null,
    siblings.length ? [h('h2', {}, 'Ebenfalls in ' + e.owner), h('div', { class: 'ref-grid' }, siblings.map(refCard))] : null,
  ];
}

function pager(prev, next) {
  return h('nav', { class: 'pager' },
    prev ? h('a', { href: prev.href, class: 'pg prev' }, h('small', {}, 'Zurück'), h('strong', {}, prev.title)) : h('span'),
    next ? h('a', { href: next.href, class: 'pg next' }, h('small', {}, 'Weiter'), h('strong', {}, next.title)) : h('span'));
}

// ---------- Layout ----------
const main = document.getElementById('docs');
const navEl = h('nav', { class: 'side' });
const article = h('article', { class: 'article' });
const toc = h('aside', { class: 'toc' });
const header = h('header', { class: 'top' },
  h('button', { class: 'icon-btn menu-btn', 'aria-label': 'Menü', onclick: () => document.body.classList.toggle('nav-open') }, frag(icon.menu)),
  h('a', { class: 'brand', href: '#/' }, h('img', { src: 'icons/logo-mark-64.png', alt: '', class: 'luna-mark' }), h('span', {}, 'Luna'), h('span', { class: 'brand-sub' }, 'Docs')),
  h('button', { class: 'search-btn', onclick: () => openSearch() }, frag(icon.search), h('span', {}, 'Suchen …'), h('kbd', {}, /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Strg K')),
  h('nav', { class: 'top-links' }, h('a', { href: '#/handbuch/start' }, 'Handbuch'), h('a', { href: '#/referenz' }, 'Referenz')),
  h('a', { class: 'btn primary app-btn', href: './' }, h('span', {}, 'Zur App')));
main.replaceChildren(header, h('div', { class: 'layout' }, navEl, h('main', { class: 'content' }, article), toc), h('div', { class: 'nav-scrim', onclick: () => document.body.classList.remove('nav-open') }));

function renderNav(route) {
  const link = (href, text, active) => h('a', { href, class: active ? 'active' : '' }, text);
  navEl.replaceChildren(
    h('div', { class: 'side-group' }, h('h4', {}, 'Handbuch'), GUIDE.map((g) => link('#/handbuch/' + g.id, g.title, route === 'handbuch/' + g.id))),
    h('div', { class: 'side-group' }, h('h4', {}, 'Referenz'), link('#/referenz', 'Übersicht', route === 'referenz'),
      GROUPS.map((g) => h('details', { open: route.startsWith('referenz/') && groupOf(getEntry(decodeURIComponent(route.slice(9))) || {}) === g },
        h('summary', {}, g.title),
        entries.filter((e) => groupOf(e) === g).map((e) => link('#/referenz/' + encodeURIComponent(e.id), fullName(e), route === 'referenz/' + encodeURIComponent(e.id)))))),
  );
}

function route() {
  const r = (location.hash.replace(/^#\/?/, '') || '').trim();
  let body, tocItems = [];
  if (r.startsWith('handbuch/')) { const p = pageGuide(r.slice(9)); body = p.body; tocItems = p.toc; }
  else if (r === 'referenz') { body = pageRefIndex(); tocItems = GROUPS.map((g) => g.title); }
  else if (r.startsWith('referenz/')) body = pageEntry(decodeURIComponent(r.slice(9)));
  else body = pageStart();
  article.replaceChildren(...[body].flat(3).filter(Boolean));
  toc.replaceChildren(tocItems.length ? h('div', {}, h('h4', {}, 'Auf dieser Seite'), tocItems.map((t) => h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); [...article.querySelectorAll('h1, h2')].find((x) => x.textContent === t)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, t))) : '');
  renderNav(r);
  document.body.classList.remove('nav-open');
  document.title = (article.querySelector('h1')?.textContent || 'Luna') + ' · Luna Docs';
  window.scrollTo(0, 0);
  navEl.querySelector('a.active')?.scrollIntoView({ block: 'nearest' });
}
addEventListener('hashchange', route);
route();

// ---------- Suche (⌘K / Strg K) ----------
function openSearch() {
  const input = h('input', { class: 'search-input', type: 'search', placeholder: 'Luna durchsuchen – z. B. wait, create, local …', autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'search-list' });
  let items = [], sel = 0;
  const close = () => overlay.remove();
  const go = (it) => { close(); location.hash = it.href; };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const guide = GUIDE.filter((g) => !q || g.title.toLowerCase().includes(q) || g.text.toLowerCase().includes(q)).map((g) => ({ title: g.title, sub: 'Handbuch', href: '#/handbuch/' + g.id, ic: icon.book2 }));
    const refs = searchDocs(q, 'luna').slice(0, 30).map((e) => ({ title: fullName(e), sub: e.desc, href: '#/referenz/' + encodeURIComponent(e.id), kind: e.kind }));
    items = q ? [...refs.slice(0, 8), ...guide.slice(0, 4), ...refs.slice(8)] : [...guide.slice(0, 6), ...refs.slice(0, 8)];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map((it, i) => h('a', { href: it.href, class: 'sr' + (i === sel ? ' sel' : ''), onclick: (e) => { e.preventDefault(); go(it); }, onpointermove: () => { sel = i; [...list.children].forEach((c, k) => c.classList.toggle('sel', k === i)); } },
      it.kind ? kindIcon(it.kind) : h('span', { class: 'sr-ic' }, frag(it.ic)), h('span', {}, h('strong', {}, it.title), h('small', {}, it.sub)))));
    if (!items.length) list.append(h('p', { class: 'muted pad' }, 'Nichts gefunden.'));
  };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); go(items[sel]); }
    else if (e.key === 'Escape') close();
  });
  const overlay = h('div', { class: 'search-overlay', onpointerdown: (e) => { if (e.target === overlay) close(); } }, h('div', { class: 'search-box' }, h('div', { class: 'search-field' }, frag(icon.search), input), list));
  document.body.append(overlay);
  render();
  input.focus();
}
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
  else if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); openSearch(); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
void SETS;
