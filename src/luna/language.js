// Luna für CodeMirror: Einfärbung, Einrückung, Kommentare und automatisches end / end).
import { StreamLanguage, LanguageSupport, keymap, Prec, indentUnit, EditorSelection } from '../../vendor/core.js';
import { parse } from './parser.js';

export const BUILTINS = new Set(['print', 'warn', 'error', 'assert', 'wait', 'spawn', 'delay', 'typeof', 'type', 'tostring', 'tonumber', 'pairs', 'ipairs', 'time', 'clock', 'create', 'rgb']);
const LIBS = new Set(['math', 'string', 'table', 'Html', 'html', 'Http', 'http', 'Storage', 'storage', 'discord', 'Discord']);
const DECL = new Set(['local', 'let', 'const']);
const KW = new Set(['if', 'then', 'else', 'elseif', 'while', 'do', 'for', 'in', 'repeat', 'until', 'return', 'break', 'continue', 'end', 'function', 'import', 'and', 'or', 'not', 'true', 'false', 'nil', 'local', 'let', 'const']);

function tokenString(stream, state) {
  const q = state.str;
  if (q === ']]') {
    if (stream.skipTo(']]')) { stream.match(']]'); state.str = null; } else stream.skipToEnd();
    return 'string';
  }
  if (stream.peek() === '{' && q !== "'") {
    stream.next();
    let depth = 1;
    while (!stream.eol() && depth) { const c = stream.next(); if (c === '{') depth++; else if (c === '}') depth--; }
    return 'variableName.special';
  }
  while (!stream.eol()) {
    const ch = stream.peek();
    if (ch === '\\') { stream.next(); stream.next(); continue; }
    if (ch === q) { stream.next(); state.str = null; return 'string'; }
    if (ch === '{' && q !== "'") return 'string';
    stream.next();
  }
  state.str = null; // Texte enden am Zeilenende
  return 'string';
}

export const lunaStream = {
  name: 'luna',
  startState: () => ({ depth: 0, comment: false, str: null, afterDot: false, afterFunction: false, afterDecl: false, pendingElseif: false }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    if (state.comment) {
      if (stream.skipTo(']]')) { stream.match(']]'); state.comment = false; } else stream.skipToEnd();
      return 'comment';
    }
    if (state.str) return tokenString(stream, state);
    if (stream.eatSpace()) return null;
    if (stream.match('--[[')) {
      state.comment = true;
      if (stream.skipTo(']]')) { stream.match(']]'); state.comment = false; } else stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('--')) {
      const rest = stream.string.slice(stream.pos);
      const idx = rest.indexOf('--');
      if (idx >= 0 && rest.slice(idx + 2).trim()) stream.pos += idx + 2; else stream.skipToEnd();
      return 'comment';
    }
    const ch = stream.peek();
    if (ch === '"' || ch === "'" || ch === '`') { stream.next(); state.str = ch; return tokenString(stream, state); }
    if (stream.match('[[')) { state.str = ']]'; return tokenString(stream, state); }
    if (stream.match(/^0x[0-9a-f_]+/i) || stream.match(/^\d[\d_]*(\.\d*)?(e[+-]?\d+)?/i) || stream.match(/^\.\d+/)) { state.afterDot = false; return 'number'; }
    if (stream.match(/^[A-Za-z_À-ɏ][\wÀ-ɏ]*/)) {
      const w = stream.current();
      const afterDot = state.afterDot;
      state.afterDot = false;
      if (!afterDot && KW.has(w)) {
        if (w === 'end') { if (stream.peek() === ')') stream.next(); state.depth = Math.max(0, state.depth - 1); return 'keyword'; }
        if (w === 'then') { if (state.pendingElseif) state.pendingElseif = false; else state.depth++; return 'keyword'; }
        if (w === 'elseif') { state.pendingElseif = true; return 'keyword'; }
        if (w === 'do' || w === 'repeat') { state.depth++; return 'keyword'; }
        if (w === 'until') { state.depth = Math.max(0, state.depth - 1); return 'keyword'; }
        if (w === 'function') { state.depth++; state.afterFunction = true; return 'keyword'; }
        if (DECL.has(w)) { state.afterDecl = true; return 'definitionKeyword'; }
        if (w === 'true' || w === 'false') return 'bool';
        if (w === 'nil') return 'null';
        if (w === 'and' || w === 'or' || w === 'not') return 'operatorKeyword';
        if (w === 'import') return 'moduleKeyword';
        return 'keyword';
      }
      const call = !!stream.match(/^\s*\(/, false);
      if (state.afterFunction) { state.afterFunction = false; return 'variableName.function.definition'; }
      if (afterDot) return call ? 'propertyName.function' : 'propertyName';
      if (state.afterDecl) { state.afterDecl = false; return 'variableName.definition'; }
      if (BUILTINS.has(w)) return 'variableName.standard';
      if (LIBS.has(w)) return 'namespace';
      return call ? 'variableName.function' : 'variableName';
    }
    state.afterDecl = false;
    if (stream.match(/^(\.\.\.|\.\.=?|[=~!<>]=|\/\/=?|[-+*/%^]=)/)) { state.afterDot = false; state.afterFunction = false; return 'operator'; }
    if (ch === '.' || ch === ':') { stream.next(); state.afterDot = true; return 'derefOperator'; }
    stream.next();
    state.afterDot = false;
    if (ch === '(') { return 'paren'; }
    if (ch === ')') { state.afterFunction = false; return 'paren'; }
    if (ch === '{') { state.depth++; return 'brace'; }
    if (ch === '}') { state.depth = Math.max(0, state.depth - 1); return 'brace'; }
    if (ch === '[' || ch === ']') return 'squareBracket';
    if (ch === ',' || ch === ';') return 'separator';
    if ('+-*/%^#<>='.includes(ch)) return 'operator';
    return null;
  },
  indent(state, textAfter, cx) {
    if (state.comment || state.str === ']]') return null;
    const closing = /^\s*(end\)?|else\b|elseif\b|until\b|\})/.test(textAfter);
    return Math.max(0, state.depth - (closing ? 1 : 0)) * cx.unit;
  },
  languageData: {
    commentTokens: { line: '--', block: { open: '--[[', close: ']]' } },
    indentOnInput: /^\s*(end\)?|else|elseif|until|\})$/,
    closeBrackets: { brackets: ['(', '[', '{', '"', "'", '`'] },
  },
};

export const lunaLanguage = StreamLanguage.define(lunaStream);

/** Enter nach then / do / function(…) / repeat: einrücken und – falls noch offen – den passenden Abschluss einfügen. */
function lunaEnter(view) {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(sel.head);
  const before = line.text.slice(0, sel.head - line.from);
  const after = line.text.slice(sel.head - line.from);
  if (after.trim()) return false;
  const code = before.replace(/--.*$/, '').trimEnd();
  let closer = null;
  if (/\bfunction\b[^()]*\([^)]*\)$/.test(code)) closer = 'end)';
  else if (/\b(then|do)$/.test(code) && !/^\s*elseif\b/.test(code)) closer = 'end';
  else if (/\brepeat$/.test(code)) closer = 'until ';
  else if (/^\s*(else|elseif\b.*then)$/.test(code)) closer = '';
  if (closer === null) return false;
  const indent = /^\s*/.exec(line.text)[0];
  const unit = state.facet(indentUnit);
  let needsCloser = false;
  if (closer) {
    try { parse(state.doc.toString()); }
    catch (e) { needsCloser = e.code === 'missing-end'; }
  }
  const insert = '\n' + indent + unit + (needsCloser ? '\n' + indent + closer : '');
  view.dispatch({
    changes: { from: sel.head, to: sel.head, insert },
    selection: EditorSelection.cursor(sel.head + 1 + indent.length + unit.length),
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

export function luna() {
  return new LanguageSupport(lunaLanguage, [Prec.high(keymap.of([{ key: 'Enter', run: lunaEnter }]))]);
}
