// Kleine Helfer ohne Abhängigkeiten.

/** DOM-Element erzeugen: h('div', {class: 'x', onclick: fn}, 'Text', kind) */
export function h(tag, attrs, ...children) {
  const el = tag === 'svg' || tag === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** HTML-Schnipsel (z. B. SVG-Icon) in einen Knoten verwandeln. */
export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Wie replaceChildren, ignoriert aber null/false */
export function setChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function uid(len = 10) {
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => abc[b % abc.length]).join('');
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Pfade ----------
export const basename = (p) => p.replace(/\/+$/, '').split('/').pop();
export const dirname = (p) => { const i = p.replace(/\/+$/, '').lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i + 1).toLowerCase(); };
export function joinPath(...parts) {
  return normalizePath(parts.filter(Boolean).join('/'));
}
export function normalizePath(p) {
  const out = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return out.join('/');
}

// ---------- Ereignisse ----------
export class Emitter {
  constructor() { this._l = new Map(); }
  on(type, fn) {
    if (!this._l.has(type)) this._l.set(type, new Set());
    this._l.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) { this._l.get(type)?.delete(fn); }
  emit(type, data) {
    for (const fn of [...(this._l.get(type) || [])]) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }
}

export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace('.', ',') + ' KB';
  return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

export function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  return `vor ${Math.round(s / 86400)} Tagen`;
}

const BINARY_EXT = new Set('png jpg jpeg gif webp avif ico bmp tif tiff psd pdf zip gz tgz rar 7z jar war class exe dll so dylib bin dat woff woff2 ttf otf eot mp3 mp4 m4a wav ogg webm mov avi mkv flac wasm pyc o a lib iso dmg'.split(' '));
export const isBinaryPath = (p) => BINARY_EXT.has(extname(p));
export const isImagePath = (p) => /^(png|jpe?g|gif|webp|avif|ico|bmp|svg)$/.test(extname(p));

/** Prüft, ob Bytes wie Text aussehen (keine NUL-Bytes in den ersten 8 KB). */
export function looksLikeText(bytes) {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return false;
  return true;
}

/** Einfache Fuzzy-Suche; liefert Punktzahl oder -1 */
export function fuzzyScore(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase(), t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct * 2 - (t.length - q.length) * 0.1 + (t.lastIndexOf('/') < direct ? 200 : 0);
  let ti = 0, score = 0, streak = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return -1;
    streak = i === ti ? streak + 1 : 0;
    score += 10 + streak * 5 - (i - ti);
    ti = i + 1;
  }
  return score;
}

export function download(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Strg+';
