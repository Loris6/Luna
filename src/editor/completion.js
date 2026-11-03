// Autovervollständigung im Stil von Bild 3: farbige Typ-Icons, hervorgehobener Treffer, Paket/Besitzer in Klammern.
// Beim Überfahren (Hover) eines Vorschlags erscheint eine sehr kurze Erklärung + Button zur passenden Doku-Seite.
import {
  autocompletion, completeAnyWord, snippetCompletion, setSelectedCompletion, selectedCompletionIndex,
  ViewPlugin, syntaxTree, Facet,
} from '../../vendor/core.js';
import { entriesFor, lookup, KIND_LABEL } from '../docs/registry.js';
import { langInfo } from '../core/langs.js';
import { h, frag } from '../core/util.js';
import { icon } from '../core/icons.js';
import { app } from '../core/store.js';

/** Sprach-ID der Datei (z. B. 'typescript') – wird pro Editor gesetzt. */
export const fileLangFacet = Facet.define({ combine: (v) => v[0] || 'text' });

// ---------- Icons ----------
const KIND_STYLE = {
  class: ['C', '#2a7deb'], interface: ['I', '#169068'], exception: ['bolt', '#2a7deb'], function: ['ƒ', '#a35ad6'],
  method: ['m', '#c94f6d'], property: ['f', '#c98a2c'], variable: ['v', '#7d64d6'], constant: ['c', '#1d9a8f'],
  keyword: ['k', '#5d6370'], namespace: ['N', '#a07a2c'], module: ['M', '#a07a2c'], type: ['T', '#16918a'],
  snippet: ['{}', '#5d6370'], tag: ['<>', '#d0582b'], attribute: ['@', '#3a8fd1'], enum: ['E', '#b3901f'],
  text: ['ab', '#4b505a'], local: ['v', '#7d64d6'],
};

export function kindIcon(kind) {
  const [letter, color] = KIND_STYLE[kind] || KIND_STYLE.text;
  const el = h('span', { class: 'kind-ic', style: { background: color } });
  if (letter === 'bolt') el.append(frag(icon.bolt));
  else { el.textContent = letter; if (letter.length > 1) el.classList.add('small'); }
  return el;
}

const CM_TYPE = { tag: 'type', attribute: 'property', exception: 'class', module: 'namespace', snippet: 'text', local: 'variable' };
const fromCmType = (t) => ({ type: 'class', property: 'property', constant: 'constant', keyword: 'keyword', variable: 'variable', function: 'function', method: 'method', namespace: 'namespace', class: 'class', interface: 'interface', enum: 'enum', text: 'text' }[t] || 'text');

// ---------- Info-Panel (Hover/Auswahl) ----------
function renderInfo(completion) {
  const e = completion.lunaEntry;
  const kind = completion.lunaKind || 'text';
  const box = h('div', { class: 'ac-info' });
  const head = h('div', { class: 'ac-info-head' },
    kindIcon(kind),
    h('span', { class: 'ac-info-name' }, completion.label),
    h('span', { class: 'ac-info-kind' }, KIND_LABEL[kind] || ''),
  );
  box.append(head);
  if (e) {
    box.append(h('div', { class: 'ac-info-desc' }, e.desc));
    if (e.sig && e.kind !== 'snippet') box.append(h('code', { class: 'ac-info-sig' }, e.sig));
    const btn = h('button', {
      class: 'ac-doc-btn', type: 'button',
      onmousedown: (ev) => ev.preventDefault(),
      onclick: (ev) => { ev.preventDefault(); app.emit('open-doc', e.id); },
    }, frag(icon.book), 'Zur Dokumentation');
    const ext = h('a', { class: 'ac-ext', href: e.url, target: '_blank', rel: 'noopener', onmousedown: (ev) => ev.preventDefault(), title: e.refName }, e.refName || 'Referenz', frag(icon.external));
    box.append(h('div', { class: 'ac-info-actions' }, btn, ext));
  } else {
    box.append(h('div', { class: 'ac-info-desc' }, completion.lunaDesc || (kind === 'text' ? 'Wort aus dieser Datei.' : 'In dieser Datei definiert.')));
  }
  return box;
}

// ---------- Optionen bauen ----------
const CALLABLE = new Set(['function', 'method']);

function callApply(label) {
  return (view, completion, from, to) => {
    const next = view.state.sliceDoc(to, to + 1);
    const hasParen = next === '(';
    const insert = hasParen ? label : label + '()';
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + label.length + (hasParen ? 0 : 1) },
      userEvent: 'input.complete',
    });
  };
}

function optionFor(e, boost = 0) {
  if (e.kind === 'snippet') {
    return snippetCompletion(e.sig, { label: e.label, detail: 'Schnipsel', type: 'text', boost: boost - 5, info: renderInfo, lunaEntry: e, lunaKind: 'snippet' });
  }
  return {
    label: e.label,
    type: CM_TYPE[e.kind] || e.kind,
    detail: e.owner ? `(${e.owner})` : e.lang === 'java' && e.kind === 'keyword' ? '' : '',
    boost,
    info: renderInfo,
    apply: CALLABLE.has(e.kind) && /^[\w$]+$/.test(e.label) ? callApply(e.label) : undefined,
    lunaEntry: e,
    lunaKind: e.kind,
  };
}

function enrich(o, lang, kind) {
  const e = lookup(lang, o.label, kind) || (lang === 'css' && kind === 'constant' ? lookup(lang, ':' + o.label) : null);
  const k = kind || fromCmType(o.type);
  return { ...o, info: renderInfo, lunaEntry: e || null, lunaKind: k, detail: o.detail || (e?.owner ? `(${e.owner})` : undefined) };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((o) => { const k = o.label + '|' + (o.detail || ''); if (seen.has(k)) return false; seen.add(k); return true; });
}

const inCommentOrString = (ctx, names) => {
  const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
  return names.includes(node.name);
};

// ---------- JavaScript / TypeScript ----------
const JS_STATIC = {
  console: ['console'], Math: ['Math'], JSON: ['JSON'], Object: ['Object'], Array: ['Array'], Promise: ['Promise'],
  Number: ['Number'], Date: ['Date'], document: ['document'], window: ['window'], globalThis: ['window'],
  localStorage: ['localStorage'], sessionStorage: ['localStorage'], navigator: ['navigator'], classList: ['DOMTokenList'],
  body: ['Element'], documentElement: ['Element'],
};
const JS_INSTANCE = ['Array.prototype', 'String.prototype', 'Element', 'Promise.prototype', 'Map.prototype', 'Set.prototype', 'Number.prototype', 'Date.prototype', 'Event', 'Response', 'DOMTokenList'];

function inferJsOwner(name, text) {
  if (name === ']') return ['Array.prototype'];
  if (/^['"`]$/.test(name)) return ['String.prototype'];
  if (name === ')') return null;
  const re = new RegExp(`(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*(?::\\s*([\\w<>\\[\\]]+))?\\s*=\\s*([^;\\n]{0,80})`);
  const m = re.exec(text);
  if (m) {
    const [, typeAnn = '', init = ''] = m;
    if (/^string/i.test(typeAnn)) return ['String.prototype'];
    if (/^number/i.test(typeAnn)) return ['Number.prototype'];
    if (/\[\]$|^Array/.test(typeAnn)) return ['Array.prototype'];
    if (/Element$/.test(typeAnn)) return ['Element'];
    if (/^\[|^Array\.(from|of)|\.(map|filter|split|slice|concat|flat|toSorted)\(|querySelectorAll|Object\.(keys|values|entries)/.test(init)) return ['Array.prototype'];
    if (/^['"`]|^String\(|\.(join|trim|toUpperCase|toLowerCase|replace)\(|\.textContent|\.value\b/.test(init)) return ['String.prototype'];
    if (/^new Map/.test(init)) return ['Map.prototype'];
    if (/^new Set/.test(init)) return ['Set.prototype', 'Map.prototype'];
    if (/^new Date/.test(init)) return ['Date.prototype'];
    if (/^await fetch/.test(init)) return ['Response'];
    if (/^(fetch|new Promise|Promise\.)/.test(init)) return ['Promise.prototype'];
    if (/querySelector\(|getElementById|createElement|\.closest\(|document\.body/.test(init)) return ['Element'];
    if (/^-?\d/.test(init)) return ['Number.prototype'];
  }
  if (/^(e|ev|evt|event)$/.test(name)) return ['Event'];
  if (/^(res|response)$/i.test(name)) return ['Response'];
  if (/^(el|element|btn|button|input|container|node|root|wrapper|card|list[A-Z]\w*El)$|El$|Element$|Button$/.test(name)) return ['Element'];
  if (/(s|List|Array|Items|arr)$/.test(name) && name.length > 2) return ['Array.prototype', 'String.prototype'];
  if (/(name|text|title|label|str|message|url|path)$/i.test(name)) return ['String.prototype'];
  return null;
}

async function jsSource(ctx, isTS) {
  if (inCommentOrString(ctx, ['String', 'LineComment', 'BlockComment', 'RegExp', 'TemplateString'])) return null;
  const lang = isTS ? 'ts' : 'js';
  const entries = entriesFor(lang);
  const member = ctx.matchBefore(/([\w$]+|\]|\)|['"`])\s*\??\.\s*[\w$]*$/);
  if (member) {
    const m = /([\w$]+|\]|\)|['"`])\s*\??\.\s*([\w$]*)$/.exec(member.text);
    const obj = m[1];
    if (/^\d+$/.test(obj)) return null;
    const partial = m[2];
    let owners = JS_STATIC[obj] || inferJsOwner(obj, ctx.state.doc.toString());
    const known = !!owners;
    if (!owners) owners = JS_INSTANCE;
    const options = entries.filter((e) => e.owner && owners.includes(e.owner)).map((e) => optionFor(e, known ? 10 - owners.indexOf(e.owner) : 0));
    if (!options.length) return null;
    return { from: ctx.pos - partial.length, options: dedupe(options), validFor: /^[\w$]*$/ };
  }
  const word = ctx.matchBefore(/[\w$]+/);
  if (!word && !ctx.explicit) return null;
  const from = word ? word.from : ctx.pos;
  const globals = entries.filter((e) => !e.owner).map((e) => optionFor(e, e.kind === 'keyword' ? 1 : 2));
  let locals = [];
  try {
    const { js } = await import('../../vendor/lang-web.js');
    const res = js.localCompletionSource(ctx);
    if (res) locals = res.options.map((o) => ({ ...o, info: renderInfo, lunaKind: o.type === 'function' ? 'function' : o.type === 'class' ? 'class' : 'local', lunaDesc: 'In dieser Datei definiert.', boost: 5 }));
  } catch {}
  const names = new Set(locals.map((o) => o.label));
  return { from, options: [...locals, ...globals.filter((o) => !names.has(o.label))], validFor: /^[\w$]*$/ };
}

// ---------- HTML / CSS ----------
async function htmlSource(ctx) {
  const { html } = await import('../../vendor/lang-web.js');
  const res = await html.htmlCompletionSource(ctx);
  const bang = ctx.matchBefore(/!$/);
  if (bang) {
    const e = lookup('html', '!');
    return { from: bang.from, options: [optionFor(e, 50)] };
  }
  if (!res) return null;
  return {
    ...res,
    options: res.options.map((o) => enrich(o, 'html', o.type === 'type' ? 'tag' : o.type === 'property' ? 'attribute' : null)),
  };
}

async function cssSource(ctx) {
  const { css } = await import('../../vendor/lang-web.js');
  const res = await css.cssCompletionSource(ctx);
  if (!res) {
    const word = ctx.matchBefore(/[@\w-]+/);
    if (!word) return null;
    const opts = entriesFor('css').filter((e) => e.kind === 'function' || e.kind === 'keyword').map((e) => optionFor(e, 1));
    return { from: word.from, options: opts, validFor: /^[@\w-]*$/ };
  }
  const extra = entriesFor('css').filter((e) => e.kind === 'function').map((e) => optionFor(e, -1));
  return { ...res, options: [...res.options.map((o) => enrich(o, 'css', o.type === 'property' ? 'property' : null)), ...(res.options.some((o) => o.type === 'property') ? [] : extra)] };
}

// ---------- Python ----------
function inferPyOwner(name, text) {
  const m = new RegExp(`^\\s*${name}\\s*(?::\\s*(\\w+))?\\s*=\\s*(.{0,40})`, 'm').exec(text);
  if (m) {
    const [, ann = '', init = ''] = m;
    if (/^(str)$/.test(ann) || /^[fbr]?['"]/.test(init) || /^str\(|\.join\(|input\(/.test(init)) return ['str'];
    if (/^list/.test(ann) || /^\[|^list\(|sorted\(|\.split\(/.test(init)) return ['list'];
    if (/^dict/.test(ann) || /^\{|^dict\(/.test(init)) return ['dict'];
  }
  if (/^['"]$/.test(name)) return ['str'];
  return null;
}

async function pySource(ctx) {
  if (inCommentOrString(ctx, ['String', 'Comment', 'FormatString'])) return null;
  const entries = entriesFor('py');
  const member = ctx.matchBefore(/([\w]+|['"\])])\.\w*$/);
  if (member) {
    const m = /([\w]+|['"\])])\.(\w*)$/.exec(member.text);
    if (entries.some((e) => e.kind === 'module' && e.label === m[1])) return null;
    const owners = inferPyOwner(m[1], ctx.state.doc.toString()) || ['str', 'list', 'dict'];
    const options = entries.filter((e) => e.owner && owners.includes(e.owner)).map((e) => optionFor(e, 5 - owners.indexOf(e.owner)));
    return options.length ? { from: ctx.pos - m[2].length, options: dedupe(options), validFor: /^\w*$/ } : null;
  }
  const word = ctx.matchBefore(/\w+/);
  if (!word && !ctx.explicit) return null;
  let locals = [];
  try {
    const { python } = await import('../../vendor/lang-more.js');
    const res = python.localCompletionSource(ctx);
    if (res) locals = res.options.map((o) => ({ ...o, info: renderInfo, lunaKind: o.type === 'function' ? 'function' : o.type === 'class' ? 'class' : 'local', boost: 5 }));
  } catch {}
  const names = new Set(locals.map((o) => o.label));
  const globals = entries.filter((e) => !e.owner && !names.has(e.label)).map((e) => optionFor(e, e.kind === 'keyword' ? 1 : 2));
  return { from: word ? word.from : ctx.pos, options: [...locals, ...globals], validFor: /^\w*$/ };
}

// ---------- Java ----------
function inferJavaOwner(name, text) {
  if (name === 'System') return null;
  const m = new RegExp(`\\b(String|List|ArrayList|Map|HashMap|Stream)(?:<[^>]*>)?\\s+${name}\\b`).exec(text);
  if (m) return [{ ArrayList: 'List', HashMap: 'Map' }[m[1]] || m[1]];
  if (name === ')') return ['Stream', 'String', 'List'];
  return null;
}

async function javaSource(ctx) {
  if (inCommentOrString(ctx, ['StringLiteral', 'LineComment', 'BlockComment', 'TextBlock'])) return null;
  const entries = entriesFor('java');
  const member = ctx.matchBefore(/([\w]+|\))\.\w*$/);
  if (member) {
    const m = /([\w]+|\))\.(\w*)$/.exec(member.text);
    if (m[1] === 'System') {
      return { from: ctx.pos - m[2].length, options: ['out', 'err', 'in'].map((l) => ({ label: l, type: 'property', detail: '(System)', info: renderInfo, lunaKind: 'property', lunaDesc: `Standard-${l === 'in' ? 'Eingabe' : l === 'out' ? 'Ausgabe' : 'Fehlerausgabe'}.` })), validFor: /^\w*$/ };
    }
    if (/^out|err$/.test(m[1])) {
      return { from: ctx.pos - m[2].length, options: ['println', 'print', 'printf'].map((l) => ({ label: l, type: 'method', detail: '(PrintStream)', apply: callApply(l), info: renderInfo, lunaKind: 'method', lunaDesc: l === 'println' ? 'Gibt Text mit Zeilenumbruch aus.' : l === 'printf' ? 'Formatierte Ausgabe.' : 'Gibt Text ohne Zeilenumbruch aus.' })), validFor: /^\w*$/ };
    }
    const owners = inferJavaOwner(m[1], ctx.state.doc.toString()) || ['String', 'List', 'Map', 'Stream'];
    const options = entries.filter((e) => e.owner && !e.owner.includes('.') && owners.includes(e.owner)).map((e) => optionFor(e, 5 - owners.indexOf(e.owner)));
    return options.length ? { from: ctx.pos - m[2].length, options: dedupe(options), validFor: /^\w*$/ } : null;
  }
  const word = ctx.matchBefore(/\w+/);
  if (!word && !ctx.explicit) return null;
  const globals = entries.filter((e) => !e.owner || e.owner.includes('.')).map((e) => optionFor(e, e.kind === 'keyword' ? 0 : 2));
  const words = await completeAnyWord(ctx);
  const names = new Set(globals.map((o) => o.label));
  const local = (words?.options || []).filter((o) => !names.has(o.label)).map((o) => ({ ...o, info: renderInfo, lunaKind: 'text', boost: -20 }));
  return { from: word ? word.from : ctx.pos, options: [...globals, ...local], validFor: /^\w*$/ };
}

// ---------- Fallback ----------
async function wordSource(ctx) {
  const res = await completeAnyWord(ctx);
  if (!res) return null;
  return { ...res, options: res.options.map((o) => ({ ...o, info: renderInfo, lunaKind: 'text' })) };
}

async function lunaSource(ctx) {
  const fileLang = ctx.state.facet(fileLangFacet);
  const nested = ctx.state.languageDataAt('lunaLang', ctx.pos)[0];
  const docs = nested || langInfo(fileLang).docs;
  const isTS = fileLang === 'typescript' || fileLang === 'tsx';
  try {
    switch (docs) {
      case 'js': case 'ts': return await jsSource(ctx, isTS);
      case 'html': return await htmlSource(ctx);
      case 'css': return await cssSource(ctx);
      case 'py': return await pySource(ctx);
      case 'java': return await javaSource(ctx);
      default: return await wordSource(ctx);
    }
  } catch (e) {
    console.warn('Vervollständigung fehlgeschlagen', e);
    return null;
  }
}

// ---------- Hover wählt den Vorschlag aus → Info-Panel zeigt Kurzbeschreibung ----------
const hoverSelect = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.last = -1;
    this.onMove = (e) => {
      const li = e.target.closest?.('.cm-tooltip-autocomplete li[id]');
      if (!li) return;
      const m = /-(\d+)$/.exec(li.id);
      if (!m) return;
      const idx = +m[1];
      if (idx === this.last && idx === selectedCompletionIndex(view.state)) return;
      this.last = idx;
      if (selectedCompletionIndex(view.state) !== idx) view.dispatch({ effects: setSelectedCompletion(idx) });
    };
    view.dom.addEventListener('mousemove', this.onMove);
  }
  destroy() { this.view.dom.removeEventListener('mousemove', this.onMove); }
});

export function lunaCompletion() {
  return [
    autocompletion({
      override: [lunaSource],
      icons: false,
      addToOptions: [{ position: 20, render: (c) => kindIcon(c.lunaKind || fromCmType(c.type)) }],
      tooltipClass: () => 'luna-ac',
      maxRenderedOptions: 60,
      interactionDelay: 50,
      activateOnTypingDelay: 60,
    }),
    hoverSelect,
  ];
}
