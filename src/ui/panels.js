// Unteres Panel (Probleme, Konsole) und rechtes Panel (Vorschau) + „Ausführen“.
import { h, frag, basename, dirname, joinPath, debounce, setChildren } from '../core/util.js';
import { icon, fileIcon } from '../core/icons.js';
import { app } from '../core/store.js';
import { forEachDiagnostic } from '../../vendor/core.js';
import { getProject, getFiles, readFile } from '../projects/projects.js';
import { allTabs, activeTab, openFile } from '../editor/editor.js';
import { toast } from './dialog.js';
import { ENABLED_LANGUAGES } from '../config.js';
import { isLunaPath } from '../luna/project.js';

let lunaRt = null;
let lunaStatus = '';

let bottom, right, bottomTab = 'problems', consoleLines = [], preview = null, runner;
const els = {};

export function initPanels(bottomEl, rightEl) {
  bottom = bottomEl; right = rightEl;
  els.btabs = h('div', { class: 'panel-tabs' });
  els.bbody = h('div', { class: 'panel-body' });
  els.bactions = h('div', { class: 'panel-actions' });
  bottom.append(h('div', { class: 'panel-head' }, els.btabs, els.bactions), els.bbody, h('div', { class: 'panel-resizer h' }));
  els.rtitle = h('span', { class: 'panel-title' }, 'Vorschau');
  els.rbody = h('div', { class: 'panel-body preview-body' });
  els.rstatus = h('span', { class: 'run-status' });
  els.stop = h('button', { class: 'icon-btn sm stop-btn', title: 'Stoppen', hidden: true, onclick: stopLuna }, h('span', { class: 'stop-sq' }));
  els.ext = h('button', { class: 'icon-btn sm', title: 'In neuem Fenster öffnen', onclick: openPreviewWindow }, frag(icon.external));
  right.append(h('div', { class: 'panel-head' }, frag(icon.eye), els.rtitle, els.rstatus, h('span', { class: 'grow' }),
    els.stop,
    h('button', { class: 'icon-btn sm', title: 'Neu starten', onclick: () => (lunaRt ? run() : refreshPreview(true)) }, frag(icon.refresh)),
    els.ext,
    h('button', { class: 'icon-btn sm', title: 'Schließen', onclick: () => app.set('rightOpen', false) }, frag(icon.close))), els.rbody, h('div', { class: 'panel-resizer v' }));
  initResizers();
  renderBottom();
  renderPreviewEmpty();
  app.on('show-problems', () => { bottomTab = 'problems'; app.set('bottomOpen', true); renderBottom(); });
  app.on('run', run);
  app.on('stop', stopLuna);
  app.on('try-luna', (code) => runLunaFiles(null, [{ path: 'beispiel.luna', source: code }]));
  app.on('settings', ({ key }) => { if (key === 'bottomOpen' && app.settings.bottomOpen) renderBottom(); });
  app.on('file-changed', debounce(({ project }) => { if (preview && preview.projectId === project.id && app.settings.rightOpen) refreshPreview(); }, 700));
  setInterval(() => { if (app.settings.bottomOpen && bottomTab === 'problems') renderProblems(); }, 1500);
  addEventListener('message', (e) => {
    if (!e.data?.__luna) return;
    const frames = [runner, els.rbody.querySelector('iframe')].filter(Boolean);
    if (!frames.some((f) => f.contentWindow === e.source)) return;
    log(e.data.level, e.data.args.join(' '));
  });
}

// ---------- Unteres Panel ----------
function renderBottom() {
  const count = problems().length;
  setChildren(els.btabs,
    h('button', { class: 'ptab' + (bottomTab === 'problems' ? ' on' : ''), onclick: () => { bottomTab = 'problems'; renderBottom(); } }, 'Probleme', count ? h('span', { class: 'count' }, count) : null),
    h('button', { class: 'ptab' + (bottomTab === 'console' ? ' on' : ''), onclick: () => { bottomTab = 'console'; renderBottom(); } }, 'Konsole', consoleLines.some((l) => l.level === 'error') ? h('span', { class: 'count err' }, '!') : null),
  );
  setChildren(els.bactions,
    bottomTab === 'console' && lunaRt && !lunaRt.done ? h('button', { class: 'btn sm stop-inline', onclick: stopLuna }, h('span', { class: 'stop-sq' }), 'Stopp') : null,
    bottomTab === 'console' ? h('button', { class: 'icon-btn sm', title: 'Konsole leeren', onclick: () => { consoleLines = []; renderBottom(); } }, frag(icon.trash)) : null,
    h('button', { class: 'icon-btn sm', title: 'Schließen', onclick: () => app.set('bottomOpen', false) }, frag(icon.close)),
  );
  if (bottomTab === 'problems') renderProblems(); else renderConsole();
}

function problems() {
  const out = [];
  for (const t of allTabs()) {
    if (!t.view) continue;
    forEachDiagnostic(t.view.state, (d, from) => {
      const line = t.view.state.doc.lineAt(Math.min(from, t.view.state.doc.length));
      out.push({ tab: t, d, line: line.number, col: from - line.from + 1 });
    });
  }
  const seen = new Set();
  return out.filter((x) => { const k = `${x.tab.projectId}:${x.tab.path}:${x.line}:${x.col}:${x.d.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function renderProblems() {
  if (bottomTab !== 'problems') return;
  const list = problems();
  els.bbody.replaceChildren(list.length
    ? h('div', { class: 'problems' }, list.map(({ tab, d, line, col }) => h('button', { class: 'problem ' + d.severity, onclick: () => openFile(getProject(tab.projectId), tab.path, { line, col }) },
      frag(d.severity === 'error' ? icon.error : icon.alert), h('span', { class: 'msg' }, d.message), frag(fileIcon(tab.path)), h('span', { class: 'loc' }, `${basename(tab.path)}:${line}:${col}`))))
    : h('div', { class: 'panel-empty' }, frag(icon.check), 'Keine Probleme in den geöffneten Dateien.'));
  const c = els.btabs.querySelector('.count:not(.err)');
  if ((c ? +c.textContent : 0) !== list.length) {
    els.btabs.firstChild?.replaceChildren('Probleme', list.length ? h('span', { class: 'count' }, list.length) : '');
  }
}

function renderConsole() {
  els.bbody.replaceChildren(consoleLines.length
    ? h('div', { class: 'console' }, consoleLines.map((l) => h('div', { class: 'cl ' + l.level }, h('span', { class: 'ts' }, l.time), h('pre', {}, l.text),
      l.loc?.file ? h('button', { class: 'cl-loc', title: 'Zur Stelle springen', onclick: () => { const p = getProject(l.loc.projectId); if (p) openFile(p, l.loc.file, { line: l.loc.line || 1 }); } }, `${l.loc.file.split('/').pop()}${l.loc.line ? ':' + l.loc.line : ''}`) : null)))
    : h('div', { class: 'panel-empty' }, frag(icon.terminal), 'Ausgaben von ▶ Ausführen erscheinen hier.'));
  els.bbody.scrollTop = els.bbody.scrollHeight;
}

export function log(level, text, loc) {
  consoleLines.push({ level, text, loc, time: new Date().toLocaleTimeString('de-DE') });
  if (consoleLines.length > 500) consoleLines.shift();
  if (bottomTab === 'console' && app.settings.bottomOpen) renderConsole(); else renderBottom();
}

// ---------- Ausführen ----------
const BRIDGE = `<script>(function(){var s=function(l,a){try{parent.postMessage({__luna:1,level:l,args:a.map(function(x){if(typeof x==='string')return x;try{return JSON.stringify(x,null,2)}catch(e){return String(x)}})},'*')}catch(e){}};['log','info','warn','error','debug','table'].forEach(function(l){var o=console[l];console[l]=function(){s(l==='table'?'log':l,[].slice.call(arguments));o&&o.apply(console,arguments)}});addEventListener('error',function(e){s('error',[e.message+(e.lineno?' (Zeile '+e.lineno+')':'')])});addEventListener('unhandledrejection',function(e){s('error',['Unbehandelt: '+((e.reason&&e.reason.message)||e.reason)])});})();<\/script>`;

const isExternal = (u) => /^(https?:|\/\/|data:|blob:|mailto:|#)/i.test(u);

async function inlineHtml(p, path, html) {
  const files = await getFiles(p);
  const base = dirname(path);
  const read = async (ref) => {
    const full = joinPath(base, ref.split(/[?#]/)[0]);
    if (!files.has(full)) return null;
    return { rec: files.get(full), text: await readFile(p, full).catch(() => null), full };
  };
  const replaceAsync = async (str, re, fn) => {
    const parts = []; let last = 0;
    for (const m of str.matchAll(re)) { parts.push(str.slice(last, m.index), await fn(...m)); last = m.index + m[0].length; }
    parts.push(str.slice(last));
    return parts.join('');
  };
  html = await replaceAsync(html, /<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, async (tag) => {
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || isExternal(href)) return tag;
    const f = await read(href);
    return f?.text != null ? `<style data-src="${href}">\n${f.text}\n</style>` : tag;
  });
  html = await replaceAsync(html, /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, async (tag, a, src, b) => {
    if (isExternal(src)) return tag;
    const f = await read(src);
    return f?.text != null ? `<script${a}${b} data-src="${src}">\n${f.text.replace(/<\/script/gi, '<\\/script')}\n</script>` : tag;
  });
  html = await replaceAsync(html, /(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, async (m, pre, src, post) => {
    if (isExternal(src)) return m;
    const f = await read(src);
    if (!f) return m;
    if (f.rec.blob) return pre + await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f.rec.blob); }) + post;
    if (/\.svg$/i.test(f.full) && f.text) return pre + 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(f.text) + post;
    return m;
  });
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + BRIDGE) : BRIDGE + html;
}

function markdownToHtml(md) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  const out = []; let inCode = false, list = null;
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) { if (list) { out.push(`</${list}>`); list = null; } out.push(inCode ? '</code></pre>' : '<pre><code>'); inCode = !inCode; continue; }
    if (inCode) { out.push(esc(line)); continue; }
    const li = /^\s*([-*]|\d+\.)\s+(.*)/.exec(line);
    if (li) { const t = /\d/.test(li[1]) ? 'ol' : 'ul'; if (list !== t) { if (list) out.push(`</${list}>`); out.push(`<${t}>`); list = t; } out.push(`<li>${inline(li[2])}</li>`); continue; }
    if (list) { out.push(`</${list}>`); list = null; }
    const hd = /^(#{1,6})\s+(.*)/.exec(line);
    if (hd) out.push(`<h${hd[1].length}>${inline(hd[2])}</h${hd[1].length}>`);
    else if (/^>\s?/.test(line)) out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return `<!doctype html><meta charset="utf-8"><style>body{font:15px/1.6 Inter,system-ui,sans-serif;color:#e8e9ee;background:#0f1013;max-width:760px;margin:24px auto;padding:0 20px}code{background:#22242a;padding:2px 5px;border-radius:5px;font-family:'JetBrains Mono',monospace}pre{background:#17181c;padding:12px;border-radius:10px;overflow:auto}pre code{background:none;padding:0}a{color:#71a3ef}blockquote{border-left:3px solid #3574f0;margin:0;padding-left:12px;color:#aab}</style>${out.join('\n')}`;
}

async function buildPreview(p, path) {
  const text = await readFile(p, path);
  if (/\.html?$/i.test(path)) return inlineHtml(p, path, text || '');
  if (/\.(md|markdown)$/i.test(path)) return markdownToHtml(text || '');
  if (/\.svg$/i.test(path)) return `<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${text}</body>`;
  return null;
}

export async function run() {
  const tab = activeTab();
  if (!tab || tab.kind !== 'file') { toast('Öffne zuerst eine .luna-Datei zum Ausführen.'); return; }
  const p = getProject(tab.projectId);
  tab.write?.flush();
  for (const t of allTabs()) t.write?.flush();
  const lang = tab.langId;
  if (lang === 'luna' || ENABLED_LANGUAGES.length === 1) {
    const files = await getFiles(p);
    const scripts = [...files.values()].filter((r) => isLunaPath(r.path) && !r.placeholder);
    if (!scripts.length) { toast('Ausführen gibt es erstmal nur für Luna – lege eine Datei mit der Endung .luna an.'); return; }
    const sources = [];
    for (const r of scripts) sources.push({ path: r.path, source: r.content ?? (await readFile(p, r.path)) ?? '' });
    return runLunaFiles(p, sources);
  }
  if (lang === 'javascript') {
    // Wird das Skript von einer HTML-Seite eingebunden? Dann diese Seite als Vorschau starten.
    const host = await findHostHtml(p, tab.path);
    if (host) { consoleLines.push({ level: 'info', text: `▶ ${host} (bindet ${basename(tab.path)} ein)`, time: new Date().toLocaleTimeString('de-DE') }); renderBottom(); return showPreview(p, host); }
    return runScript(p, tab.path);
  }
  if (['html', 'markdown', 'svg'].includes(lang)) return showPreview(p, tab.path);
  const files = await getFiles(p);
  const index = files.has('index.html') ? 'index.html' : [...files.keys()].find((k) => /(^|\/)index\.html$/.test(k));
  if (index && ['css', 'typescript', 'json'].includes(lang)) return showPreview(p, index);
  toast(`${lang === 'typescript' ? 'TypeScript' : 'Diese Sprache'} kann (noch) nicht direkt im Browser ausgeführt werden.${index ? '' : ' Lege eine index.html an, um eine Vorschau zu sehen.'}`);
}

// ---------- Luna ausführen ----------
function setRunStatus(s) {
  lunaStatus = s;
  const running = s === 'läuft' || s === 'wartet auf Ereignisse';
  els.rstatus.textContent = s ? `· ${s}` : '';
  els.rstatus.className = 'run-status ' + (running ? 'on' : '');
  els.stop.hidden = !running;
  document.body.classList.toggle('luna-running', running);
  if (!running && s) log(s === 'fertig' ? 'info' : s === 'gestoppt' ? 'warn' : 'error', s === 'fertig' ? '■ Programm beendet.' : s === 'gestoppt' ? '■ Gestoppt.' : `■ ${s}`);
  renderBottom();
}

export function stopLuna() { lunaRt?.stop(); }

async function runLunaFiles(p, sources) {
  lunaRt?.stop();
  lunaStatus = '';
  const { LunaRuntime } = await import('../luna/runtime.js');
  preview = null;
  els.rtitle.textContent = 'Luna';
  els.ext.hidden = true;
  const host = h('div', { class: 'luna-stage-host' });
  els.rbody.classList.add('luna');
  els.rbody.replaceChildren(h('div', { class: 'panel-empty' }, frag(icon.play), h('div', {}, 'Luna läuft. Buttons & Co. erscheinen hier, sobald ein Script „import Html“ benutzt.')));
  consoleLines.push({ level: 'info', text: `▶ ${p ? p.name + ': ' : ''}${sources.map((x) => x.path).join(', ')}`, time: new Date().toLocaleTimeString('de-DE') });
  bottomTab = 'console';
  app.set('bottomOpen', true);
  renderBottom();
  const rt = new LunaRuntime({
    out: (level, text, loc) => log(level, text, loc && p ? { ...loc, projectId: p.id } : null),
    stageHost: host,
    projectId: p?.id || 'beispiel',
    onStatus: (st) => { if (rt === lunaRt) setRunStatus(st); },
    onStage: () => { els.rbody.replaceChildren(host); app.set('rightOpen', true); },
  });
  lunaRt = rt;
  await rt.run(sources);
}

async function findHostHtml(p, path) {
  const files = await getFiles(p);
  for (const [k, rec] of files) {
    if (!/\.html?$/i.test(k) || rec.content == null) continue;
    for (const m of rec.content.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      if (!isExternal(m[1]) && joinPath(dirname(k), m[1].split(/[?#]/)[0]) === path) return k;
    }
  }
  return null;
}

async function runScript(p, path) {
  const code = await readFile(p, path);
  runner?.remove();
  runner = h('iframe', { sandbox: 'allow-scripts allow-modals', style: 'display:none', title: 'Ausführung' });
  document.body.append(runner);
  consoleLines.push({ level: 'info', text: `▶ ${p.name} / ${path}`, time: new Date().toLocaleTimeString('de-DE') });
  bottomTab = 'console';
  app.set('bottomOpen', true);
  renderBottom();
  runner.srcdoc = `<!doctype html><html><head>${BRIDGE}</head><body><script type="module">\n${(code || '').replace(/<\/script/gi, '<\\/script')}\n</script></body></html>`;
}

async function showPreview(p, path) {
  lunaRt?.stop();
  preview = { projectId: p.id, path };
  els.rbody.classList.remove('luna');
  els.ext.hidden = false;
  app.set('rightOpen', true);
  await refreshPreview(true);
}

async function refreshPreview() {
  if (!preview) return;
  const p = getProject(preview.projectId);
  if (!p) return;
  const html = await buildPreview(p, preview.path);
  if (html == null) return;
  els.rtitle.textContent = basename(preview.path);
  let frame = els.rbody.querySelector('iframe');
  if (!frame) { frame = h('iframe', { sandbox: 'allow-scripts allow-modals allow-forms allow-popups', title: 'Vorschau' }); els.rbody.replaceChildren(frame); }
  frame.srcdoc = html;
}

async function openPreviewWindow() {
  if (!preview) return;
  const html = await buildPreview(getProject(preview.projectId), preview.path);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function renderPreviewEmpty() {
  els.rbody.replaceChildren(h('div', { class: 'panel-empty' }, frag(icon.eye), h('div', {}, 'Öffne eine HTML- oder Markdown-Datei und drücke ▶.')));
}

function initResizers() {
  const bh = bottom.querySelector('.panel-resizer.h');
  bh.addEventListener('pointerdown', (e) => drag(e, bh, (dx, dy, start) => { const v = Math.max(100, Math.min(innerHeight * 0.7, start - dy)); document.documentElement.style.setProperty('--bottom-h', v + 'px'); return v; }, bottom.offsetHeight, 'bottomHeight'));
  const rv = right.querySelector('.panel-resizer.v');
  rv.addEventListener('pointerdown', (e) => drag(e, rv, (dx, dy, start) => { const v = Math.max(240, Math.min(innerWidth * 0.7, start - dx)); document.documentElement.style.setProperty('--right-w', v + 'px'); return v; }, right.offsetWidth, 'rightWidth'));
}

function drag(e, handle, apply, start, key) {
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  const x0 = e.clientX, y0 = e.clientY;
  let last = start;
  document.body.classList.add('resizing');
  const move = (ev) => { last = apply(ev.clientX - x0, ev.clientY - y0, start); };
  const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); app.set(key, Math.round(last)); };
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
}
