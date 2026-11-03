// Autovervollständigung im Stil von Bild 3: farbige Typ-Icons, hervorgehobener Treffer, Paket/Besitzer in Klammern.
// Beim Überfahren (Hover) eines Vorschlags erscheint eine sehr kurze Erklärung + Button zur passenden Doku-Seite.
import {
  autocompletion, completeAnyWord, snippetCompletion, setSelectedCompletion, selectedCompletionIndex,
  ViewPlugin, syntaxTree, Facet, startCompletion,
} from '../../vendor/core.js';
import { otherScripts } from '../luna/project.js';
import { UI_TYPES, LIB_NAMES } from '../luna/runtime.js';
import { tokenize } from '../luna/parser.js';
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
  text: ['ab', '#4b505a'], local: ['v', '#7d64d6'], event: ['bolt', '#c98a2c'],
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
    const internal = e.url?.startsWith('luna:');
    const ext = internal
      ? h('button', { class: 'ac-ext', type: 'button', onmousedown: (ev) => ev.preventDefault(), onclick: (ev) => { ev.preventDefault(); app.emit('open-guide', e.url.split(':')[2]); } }, e.refName, frag(icon.book))
      : h('a', { class: 'ac-ext', href: e.url, target: '_blank', rel: 'noopener', onmousedown: (ev) => ev.preventDefault(), title: e.refName }, e.refName || 'Referenz', frag(icon.external));
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


// ---------- Luna ----------
const LUNA_EVENTS = new Set(['click', 'changed', 'submit', 'mouseenter', 'mouseleave', 'message']);

function lunaInComment(before) {
  let q = null;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '-' && before[i + 1] === '-') return true;
  }
  return false;
}
function lunaInString(before) {
  let q = null, brace = 0;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (q) {
      if (brace) { if (c === '{') brace++; else if (c === '}') brace--; continue; }
      if (c === '\\') i++; else if (c === q) q = null; else if (c === '{' && q !== "'") brace = 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') q = c;
  }
  return !!q && !brace;
}

/** Namen, die im Dokument angelegt werden */
function lunaLocals(text) {
  const out = new Map();
  for (const m of text.matchAll(/\b(local|let|const)\s+(?!function\b)([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)/g)) {
    for (const n of m[2].split(',')) out.set(n.trim(), { kind: m[1] === 'const' ? 'constant' : 'variable', detail: `(${m[1]})` });
  }
  for (const m of text.matchAll(/\b(local\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g)) {
    out.set(m[2], { kind: 'function', detail: m[1] ? '(local function)' : '(function)', params: m[3] });
    for (const p of m[3].split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z_]\w*$/.test(x))) if (!out.has(p)) out.set(p, { kind: 'variable', detail: '(Parameter)' });
  }
  for (const m of text.matchAll(/\bfunction\s*\(([^)]*)\)/g)) {
    for (const p of m[1].split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z_]\w*$/.test(x))) if (!out.has(p)) out.set(p, { kind: 'variable', detail: '(Parameter)' });
  }
  for (const m of text.matchAll(/\bfor\s+([A-Za-z_]\w*)(?:\s*,\s*([A-Za-z_]\w*))?/g)) {
    for (const n of [m[1], m[2]].filter(Boolean)) if (!out.has(n)) out.set(n, { kind: 'variable', detail: '(Schleife)' });
  }
  return out;
}

/** Welcher Abschluss wird an dieser Stelle erwartet? (end) für Funktionen, end für if/Schleifen, until für repeat) */
function lunaExpectedCloser(textBefore) {
  let tokens;
  try { tokens = tokenize(textBefore).tokens; } catch { return null; }
  const stack = [];
  let pendingLoop = null;
  for (const t of tokens) {
    if (t.t !== 'kw') continue;
    const v = t.v;
    if (v === 'while' || v === 'for') { pendingLoop = v; continue; }
    if (v === 'function') stack.push({ closer: 'end)', what: 'function', from: t.from });
    else if (v === 'then' && !(stack.length && stack[stack.length - 1].elseif)) stack.push({ closer: 'end', what: 'if', from: t.from });
    else if (v === 'then') stack[stack.length - 1].elseif = false;
    else if (v === 'elseif' && stack.length) stack[stack.length - 1].elseif = true;
    else if (v === 'do') { stack.push({ closer: 'end', what: pendingLoop || 'do', from: t.from }); pendingLoop = null; }
    else if (v === 'repeat') stack.push({ closer: 'until', what: 'repeat', from: t.from });
    else if (v === 'end' || v === 'end)' || v === 'until') stack.pop();
  }
  const top = stack[stack.length - 1];
  if (!top) return null;
  return { ...top, line: textBefore.slice(0, top.from).split('\n').length };
}

function lunaElementType(name, text) {
  const re = new RegExp(`\\b${name}\\s*=\\s*create\\(\\s*["'\`](\\w+)`);
  const m = re.exec(text);
  return m ? m[1] : null;
}

function withImport(lib, label, insertText, cursorOffset, reopen) {
  return (view, completion, from, to) => {
    const doc = view.state.doc.toString();
    const has = new RegExp(`^\\s*import\\b[^\\n]*\\b${lib}\\b`, 'mi').test(doc);
    const head = has ? '' : `import ${lib}\n`;
    view.dispatch({
      changes: [...(has ? [] : [{ from: 0, insert: head }]), { from, to, insert: insertText }],
      selection: { anchor: from + head.length + cursorOffset },
      userEvent: 'input.complete',
    });
    if (reopen) setTimeout(() => startCompletion(view), 20);
  };
}

async function lunaLangSource(ctx) {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  if (lunaInComment(before)) return null;
  const all = entriesFor('luna');
  const doc = ctx.state.doc.toString();

  // create("…  → Element-Typen
  let m = /create\(\s*(["'`])(\w*)$/.exec(before);
  if (m) {
    return { from: ctx.pos - m[2].length, options: UI_TYPES.map((t) => optionFor(all.find((e) => e.owner === 'Html' && e.label === t), 5)).filter(Boolean), validFor: /^\w*$/ };
  }
  if (lunaInString(before)) return null;

  // import …  → Bibliotheken
  m = /^\s*import\s+(?:\w+\s*,\s*)*(\w*)$/.exec(before);
  if (m) return { from: ctx.pos - m[1].length, options: all.filter((e) => e.kind === 'module').map((e) => optionFor(e, 5)), validFor: /^\w*$/ };

  // ereignis:  → ConnectTo
  m = /([A-Za-z_]\w*)\s*\.\s*(\w+)\s*:\s*(\w*)$/.exec(before);
  if (m && LUNA_EVENTS.has(m[2].toLowerCase())) {
    const e = all.find((x) => x.owner === 'Event' && x.label === 'ConnectTo');
    const opts = [
      snippetCompletion('ConnectTo(function()\n\t${}\nend)', { label: 'ConnectTo', detail: '(Event)', type: 'method', boost: 10, info: renderInfo, lunaEntry: e, lunaKind: 'method' }),
      ...all.filter((x) => x.owner === 'Event' && x.label !== 'ConnectTo').map((x) => optionFor(x, 2)),
    ];
    return { from: ctx.pos - m[3].length, options: opts, validFor: /^\w*$/ };
  }

  // objekt.  /  objekt:
  m = /([A-Za-z_]\w*)\s*([.:])\s*(\w*)$/.exec(before);
  if (m) {
    const [, obj, sep, partial] = m;
    const from = ctx.pos - partial.length;
    let owners = null;
    if (['math', 'string', 'table'].includes(obj)) owners = [obj];
    else if (LIB_NAMES[obj.toLowerCase()]) owners = [LIB_NAMES[obj.toLowerCase()]];
    else if (lunaElementType(obj, doc)) owners = ['Element'];
    else if (new RegExp(`\\b${obj}\\s*=\\s*["'\`]`).test(doc)) owners = ['string'];
    else if (obj === 'msg' || obj === 'message') {
      const opts = [['content', 'Text der Nachricht'], ['author', 'Wer sie geschrieben hat'], ['channel', 'Kanal']].map(([l, d]) => ({ label: l, type: 'property', detail: '(Nachricht)', info: renderInfo, lunaKind: 'property', lunaDesc: d }));
      opts.push({ label: 'reply', type: 'method', detail: '(Nachricht)', apply: callApply('reply'), info: renderInfo, lunaKind: 'method', lunaDesc: 'Antwortet auf die Nachricht: msg:reply("…")' });
      return { from, options: opts, validFor: /^\w*$/ };
    } else owners = sep === ':' ? ['string', 'Element'] : ['Element'];
    let list = all.filter((e) => owners.includes(e.owner) && e.kind !== 'class');
    if (sep === ':') list = list.filter((e) => e.kind === 'method' || e.kind === 'function');
    else if (owners.includes('Element')) list = list.filter((e) => e.kind !== 'method');
    const opts = list.map((e) => {
      const o = optionFor(e, e.kind === 'event' ? 3 : 2);
      if (e.kind === 'event' && sep === '.') o.detail = '(Ereignis)';
      if (e.owner === 'Element' && e.kind === 'method') o.apply = callApply(e.label);
      return o;
    });
    return opts.length ? { from, options: opts, validFor: /^\w*$/ } : null;
  }

  const word = ctx.matchBefore(/[A-Za-z_]\w*/);
  if (!word && !ctx.explicit) return null;
  const from = word ? word.from : ctx.pos;
  const opts = [];
  const seen = new Set();
  const add = (o) => { if (!seen.has(o.label + (o.lunaKind === 'snippet' ? '#' : ''))) { seen.add(o.label + (o.lunaKind === 'snippet' ? '#' : '')); opts.push(o); } };
  // eigene Namen aus dieser Datei
  const current = word ? ctx.state.sliceDoc(word.from, word.to) : '';
  for (const [name, info] of lunaLocals(doc)) {
    if (name === current) continue;
    add({ label: name, type: info.kind === 'function' ? 'function' : 'variable', detail: info.detail, boost: 6, info: renderInfo, lunaKind: info.kind, lunaDesc: info.kind === 'function' ? `Funktion aus dieser Datei${info.params ? ` – Parameter: ${info.params || 'keine'}` : ''}.` : 'In dieser Datei angelegt.', apply: info.kind === 'function' ? callApply(name) : undefined });
  }
  // aus anderen Scripts des Projekts (ohne local)
  for (const o of otherScripts(ctx.state)) {
    for (const [name, info] of o.summary.globals) {
      add({ label: name, type: info.kind === 'function' ? 'function' : 'variable', detail: `(${o.path.split('/').pop()})`, boost: 4, info: renderInfo, lunaKind: info.kind === 'function' ? 'function' : info.kind === 'const' ? 'constant' : 'variable', lunaDesc: `${info.kind === 'function' ? 'Funktion' : info.kind === 'const' ? 'Konstante (const)' : 'Variable (let)'} aus ${o.path}.`, apply: info.kind === 'function' ? callApply(name) : undefined });
    }
  }
  // passender Abschluss für den offenen Block
  const close = lunaExpectedCloser(doc.slice(0, from));
  if (close) {
    const e = all.find((x) => x.kind === 'keyword' && x.label === (close.closer === 'until' ? 'until' : close.closer));
    add({ label: close.closer, type: 'keyword', detail: `(schließt ${close.what} aus Zeile ${close.line})`, boost: 30, info: renderInfo, lunaEntry: e, lunaKind: 'keyword' });
  }
  for (const e of all) {
    if (e.owner && e.owner !== 'Html') continue;
    if (e.kind === 'class' || e.kind === 'module' || (e.kind === 'keyword' && (e.label === 'end)' || e.label === 'end' || e.label === 'until'))) continue;
    const o = optionFor(e, e.kind === 'keyword' ? 1 : e.kind === 'snippet' ? -2 : 2);
    if (e.owner === 'Html') {
      o.detail = '(Html)';
      o.apply = e.label === 'create' ? withImport('Html', 'create', 'create("")', 'create("'.length, true) : withImport('Html', e.label, e.label + '()', e.label.length + 1, false);
    }
    add(o);
  }
  return { from, options: opts, validFor: /^\w*$/ };
}

async function lunaSource(ctx) {
  const fileLang = ctx.state.facet(fileLangFacet);
  const nested = ctx.state.languageDataAt('lunaLang', ctx.pos)[0];
  const docs = nested || langInfo(fileLang).docs;
  const isTS = fileLang === 'typescript' || fileLang === 'tsx';
  try {
    switch (docs) {
      case 'luna': return await lunaLangSource(ctx);
      case 'js': case 'ts': return await jsSource(ctx, isTS);
      case 'html': return await htmlSource(ctx);
      case 'css': return await cssSource(ctx);
      case 'py': return await pySource(ctx);
      case 'java': return await javaSource(ctx);
      default: return null;
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
