// Luna – Prüfung im Editor: Syntax (end / end)), const, local über Dateigrenzen, fehlende Imports, unbekannte Namen.
import { parse, LunaSyntaxError } from './parser.js';
import { LIB_GLOBALS, LIB_NAMES } from './runtime.js';
import { BUILTINS } from './language.js';

export const GLOBAL_NAMES = new Set([...BUILTINS, 'math', 'string', 'table'].filter((n) => !LIB_GLOBALS[n]));

// ---------- Übersicht einer Datei (für andere Scripts im Projekt) ----------
const summaryCache = new Map();
export function summarize(src) {
  const hit = summaryCache.get(src);
  if (hit) return hit;
  const s = { ok: true, globals: new Map(), locals: new Map(), imports: new Set() };
  try {
    const ast = parse(src);
    for (const st of ast.body) {
      if (st.type === 'Decl') for (const n of st.names) (st.kind === 'local' ? s.locals : s.globals).set(n.name, { kind: st.kind, line: st.line });
      else if (st.type === 'FunctionDecl' && st.path.length === 1) (st.local ? s.locals : s.globals).set(st.name, { kind: 'function', line: st.line, params: st.func.params });
      else if (st.type === 'Import') for (const l of st.libs) s.imports.add(l.name.toLowerCase());
    }
  } catch { s.ok = false; }
  if (summaryCache.size > 200) summaryCache.clear();
  summaryCache.set(src, s);
  return s;
}

// ---------- Prüfung ----------
const QUICK = {
  'func-paren': (e) => [{ name: 'end) einsetzen', apply: (view, from, to) => view.dispatch({ changes: { from, to, insert: 'end)' } }) }],
  'if-paren': () => [{ name: ') entfernen', apply: (view, from, to) => view.dispatch({ changes: { from: to - 1, to } }) }],
  'loop-paren': () => [{ name: ') entfernen', apply: (view, from, to) => view.dispatch({ changes: { from, to } }) }],
};

function importAction(lib) {
  return [{ name: `import ${lib} einfügen`, apply: (view) => view.dispatch({ changes: { from: 0, insert: `import ${lib}\n` } }) }];
}

/**
 * @param {string} src
 * @param {{ others: Array<{path: string, summary: object}> }} ctx
 */
export function analyze(src, ctx = { others: [] }) {
  const out = [];
  let ast;
  try { ast = parse(src); }
  catch (e) {
    if (!(e instanceof LunaSyntaxError)) throw e;
    const d = { from: e.from, to: Math.min(e.to, src.length), severity: 'error', message: e.message, source: 'Luna' };
    if (QUICK[e.code]) d.actions = QUICK[e.code](e);
    out.push(d);
    return out;
  }
  for (const w of ast.warnings) out.push({ from: w.from, to: w.to, severity: 'warning', message: w.message, source: 'Luna', actions: QUICK[w.code]?.() });

  const file = summarize(src);
  const projGlobals = new Map();
  const projLocals = new Map();
  for (const o of ctx.others) {
    for (const [n, info] of o.summary.globals) projGlobals.set(n, { ...info, path: o.path });
    for (const [n, info] of o.summary.locals) if (!file.globals.has(n) && !file.locals.has(n)) projLocals.set(n, { ...info, path: o.path });
  }
  const imports = new Set();
  const visitImports = (nodes) => { for (const st of nodes) if (st.type === 'Import') for (const l of st.libs) imports.add(l.name.toLowerCase()); };
  visitImports(ast.body);

  const report = (node, severity, message, actions) => out.push({ from: node.from, to: Math.max(node.to, node.from + 1), severity, message, source: 'Luna', actions });

  const top = { vars: new Map(), parent: null, top: true };
  for (const [n, info] of file.globals) top.vars.set(n, info.kind === 'function' ? 'function' : info.kind);
  for (const [n, info] of file.locals) top.vars.set(n, info.kind === 'function' ? 'local' : info.kind);
  for (const lib of imports) {
    const real = LIB_NAMES[lib];
    if (real) { top.vars.set(real, 'import'); top.vars.set(lib, 'import'); }
  }

  const find = (name, scope) => {
    for (let s = scope; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name);
    if (GLOBAL_NAMES.has(name)) return 'builtin';
    if (LIB_GLOBALS[name] && imports.has(LIB_GLOBALS[name].toLowerCase())) return 'import';
    if (projGlobals.has(name)) return projGlobals.get(name).kind;
    return null;
  };

  const unknown = (node, name) => {
    if (LIB_GLOBALS[name]) return report(node, 'error', `„${name}“ gehört zur Bibliothek ${LIB_GLOBALS[name]} – oben fehlt: import ${LIB_GLOBALS[name]}`, importAction(LIB_GLOBALS[name]));
    const lib = LIB_NAMES[name.toLowerCase()];
    if (lib) return report(node, 'error', `„${name}“ ist eine Bibliothek – oben fehlt: import ${lib}`, importAction(lib));
    if (projLocals.has(name)) {
      const l = projLocals.get(name);
      return report(node, 'error', `„${name}“ ist in ${l.path} als local angelegt und deshalb nur dort aufrufbar. Entferne dort „local“, damit es überall geht.`);
    }
    report(node, 'warning', `„${name}“ ist nicht definiert. Lege es mit local, let oder const an.`);
  };

  const block = (stmts, parent) => { const scope = { vars: new Map(), parent }; for (const st of stmts) stmt(st, scope); };
  const fn = (f, parent) => {
    const scope = { vars: new Map(), parent };
    if (f.method) scope.vars.set('self', 'local');
    for (const p of f.params) scope.vars.set(p, 'local');
    if (f.vararg) scope.vars.set('...', 'local');
    for (const st of f.body) stmt(st, scope);
  };

  function stmt(st, scope) {
    switch (st.type) {
      case 'Decl':
        st.values.forEach((v) => expr(v, scope));
        for (const n of st.names) {
          if (st.kind !== 'local' && scope.top && projGlobals.has(n.name)) {
            const g = projGlobals.get(n.name);
            report({ from: n.from, to: n.to }, g.kind === 'const' || st.kind === 'const' ? 'error' : 'warning', `„${n.name}“ gibt es schon in ${g.path} (Zeile ${g.line}).`);
          }
          scope.vars.set(n.name, st.kind);
        }
        if (st.values.length > st.names.length) report(st.values[st.names.length], 'warning', 'Mehr Werte als Namen – der Rest wird ignoriert.');
        break;
      case 'FunctionDecl':
        if (st.path.length === 1) {
          if (st.local) scope.vars.set(st.name, 'local');
          else if (scope.top && projGlobals.has(st.name)) report({ from: st.nameFrom, to: st.nameFrom + st.name.length }, 'error', `Die Funktion „${st.name}“ gibt es schon in ${projGlobals.get(st.name).path}.`);
        } else if (!find(st.path[0], scope)) unknown({ from: st.nameFrom, to: st.nameFrom + st.path[0].length }, st.path[0]);
        fn(st.func, scope);
        break;
      case 'Assign':
        st.values.forEach((v) => expr(v, scope));
        for (const t of st.targets) target(t, scope, false);
        break;
      case 'CompoundAssign': expr(st.value, scope); target(st.target, scope, true); break;
      case 'CallStat': expr(st.call, scope); break;
      case 'If':
        for (const c of st.clauses) { expr(c.cond, scope); block(c.body, scope); }
        if (st.orelse) block(st.orelse, scope);
        break;
      case 'While': expr(st.cond, scope); block(st.body, scope); break;
      case 'Repeat': {
        const inner = { vars: new Map(), parent: scope };
        for (const s of st.body) stmt(s, inner);
        expr(st.cond, inner);
        break;
      }
      case 'NumFor': {
        expr(st.start, scope); expr(st.stop, scope); if (st.step) expr(st.step, scope);
        const inner = { vars: new Map([[st.var, 'local']]), parent: scope };
        for (const s of st.body) stmt(s, inner);
        break;
      }
      case 'GenFor': {
        st.iter.forEach((e) => expr(e, scope));
        const inner = { vars: new Map(st.names.map((n) => [n, 'local'])), parent: scope };
        for (const s of st.body) stmt(s, inner);
        break;
      }
      case 'Do': block(st.body, scope); break;
      case 'Return': st.values.forEach((v) => expr(v, scope)); break;
      case 'Import':
        for (const l of st.libs) if (!LIB_NAMES[l.name.toLowerCase()]) report(l, 'error', `Die Bibliothek „${l.name}“ gibt es nicht. Verfügbar: ${Object.values(LIB_NAMES).join(', ')}.`);
        break;
      default: break;
    }
  }

  function target(t, scope, mustExist) {
    if (t.type === 'Name') {
      const k = find(t.name, scope);
      if (k === 'const') report(t, 'error', `„${t.name}“ ist const und kann nicht geändert werden. Benutze let, wenn sich der Wert ändern soll.`);
      else if (k === 'import') report(t, 'error', `„${t.name}“ kommt aus einer Bibliothek und kann nicht überschrieben werden.`);
      else if (!k) {
        if (mustExist) unknown(t, t.name);
        else if (projLocals.has(t.name)) unknown(t, t.name);
        else report(t, 'warning', `„${t.name}“ wurde nicht angelegt – schreibe local, let oder const davor.`);
        scope.vars.set(t.name, 'let');
      }
    } else if (t.type === 'Index') { expr(t.obj, scope); expr(t.key, scope); }
  }

  function expr(e, scope) {
    if (!e) return;
    switch (e.type) {
      case 'Name': if (!find(e.name, scope)) unknown(e, e.name); break;
      case 'Index': expr(e.obj, scope); expr(e.key, scope); break;
      case 'Call': expr(e.fn, scope); e.args.forEach((a) => expr(a, scope)); break;
      case 'MethodCall': expr(e.obj, scope); e.args.forEach((a) => expr(a, scope)); break;
      case 'Function': fn(e, scope); break;
      case 'Binary': expr(e.left, scope); expr(e.right, scope); break;
      case 'Unary': expr(e.arg, scope); break;
      case 'Paren': expr(e.expr, scope); break;
      case 'Table': for (const f of e.fields) { if (f.key) expr(f.key, scope); expr(f.value, scope); } break;
      case 'Template': for (const p of e.parts) if (typeof p !== 'string') expr(p, scope); break;
      default: break;
    }
  }

  for (const st of ast.body) stmt(st, top);
  return out;
}

// ---------- Funktion unter dem Cursor (Statuszeile) ----------
let lastSrc = null, lastAst = null;
export function lunaSymbolPath(src, pos) {
  if (src !== lastSrc) {
    lastSrc = src;
    try { lastAst = parse(src); } catch { lastAst = null; }
  }
  if (!lastAst) return [];
  const names = [];
  const visit = (nodes) => {
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue;
      if (n.from > pos || n.to < pos) continue;
      if (n.type === 'FunctionDecl') { names.push(n.name); visit(n.func.body); return; }
      if (n.type === 'Function' && n !== lastAst) { names.push(n.name || 'function()'); visit(n.body); return; }
      for (const k of ['body', 'orelse', 'args', 'values', 'fields']) if (Array.isArray(n[k])) visit(n[k].map((x) => x?.value || x));
      if (n.clauses) for (const c of n.clauses) visit(c.body);
      if (n.call) visit([n.call]);
      for (const k of ['fn', 'obj', 'expr', 'left', 'right', 'arg']) if (n[k]) visit([n[k]]);
    }
  };
  visit(lastAst.body);
  return names;
}
