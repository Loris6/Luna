// Zentrale Doku-/Vorschlagsdatenbank.
import js from './data/js.js';
import ts from './data/ts.js';
import html from './data/html.js';
import css from './data/css.js';
import py from './data/py.js';
import java from './data/java.js';

export const SETS = { js, ts, html, css, py, java };

export const KIND_LABEL = {
  class: 'Klasse', interface: 'Interface', function: 'Funktion', method: 'Methode', property: 'Eigenschaft',
  keyword: 'Schlüsselwort', namespace: 'Namensraum', exception: 'Ausnahme', snippet: 'Schnipsel', type: 'Typ',
  variable: 'Variable', constant: 'Konstante', tag: 'HTML-Element', attribute: 'Attribut', module: 'Modul',
  enum: 'Enum', text: 'Wort', local: 'Lokal',
};

const all = [];
const byId = new Map();
const byLang = new Map();

for (const set of Object.values(SETS)) {
  const list = [];
  for (const [kind, owner, label, sig, desc, ref] of set.entries) {
    const id = `${set.id}:${kind === 'attribute' ? '@' : ''}${owner ? owner + '.' : ''}${label}`;
    const e = { id, lang: set.id, langName: set.name, kind, owner, label, sig, desc, ref };
    list.push(e);
  }
  for (const e of list) {
    e.url = set.url(e, list);
    e.refName = set.refName;
    byId.set(e.id, e);
    all.push(e);
  }
  byLang.set(set.id, list);
}

/** Alle Einträge einer Sprache (inkl. geerbter, z. B. TS ← JS) */
export function entriesFor(lang) {
  const set = SETS[lang];
  if (!set) return [];
  const own = byLang.get(lang) || [];
  return set.extends ? [...own, ...entriesFor(set.extends)] : own;
}

export const getEntry = (id) => byId.get(id);
export const allEntries = () => all;

export function lookup(lang, label, kind) {
  return entriesFor(lang).find((e) => e.label === label && (!kind || e.kind === kind) && !e.owner)
    || entriesFor(lang).find((e) => e.label === label && (!kind || e.kind === kind));
}

/** Verwandte Einträge (gleicher Besitzer bzw. Mitglieder einer Klasse) */
export function related(entry) {
  const list = entriesFor(entry.lang);
  const owners = new Set([entry.owner, entry.label, entry.label + '.prototype'].filter(Boolean));
  return list.filter((e) => e !== entry && e.owner && owners.has(e.owner)).slice(0, 24);
}

export function searchDocs(query, lang) {
  const q = query.trim().toLowerCase();
  const pool = lang ? (byLang.get(lang) || []) : all;
  if (!q) return pool.slice(0, 200);
  const scored = [];
  for (const e of pool) {
    const name = (e.owner ? e.owner + '.' : '') + e.label;
    const l = e.label.toLowerCase();
    let s = -1;
    if (l === q) s = 100; else if (l.startsWith(q)) s = 80; else if (name.toLowerCase().includes(q)) s = 50; else if (e.desc.toLowerCase().includes(q)) s = 20;
    if (s >= 0) scored.push([s, e]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label)).slice(0, 200).map((x) => x[1]);
}
