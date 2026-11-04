// Luna – Interpreter. Läuft im Browser; wait() pausiert nur das jeweilige Script.
import { parse, LunaSyntaxError, lineAt } from './parser.js';

// ---------- Werte ----------
export class LTable {
  constructor() { this.hash = new Map(); }
  get(k) { return this.hash.get(k); }
  set(k, v) {
    if (k === undefined) throw new Error('Tabellen-Schlüssel darf nicht nil sein.');
    if (Number.isNaN(k)) throw new Error('Tabellen-Schlüssel darf nicht NaN sein.');
    if (v === undefined) this.hash.delete(k); else this.hash.set(k, v);
  }
  length() { let n = 0; while (this.hash.has(n + 1)) n++; return n; }
  get lunaType() { return 'table'; }
}
export class LFunction {
  constructor(node, closure, file, name) { this.node = node; this.closure = closure; this.file = file; this.name = name || node.name || 'anonym'; }
  get lunaType() { return 'function'; }
}
export class Native {
  constructor(name, fn) { this.name = name; this.fn = fn; }
  get lunaType() { return 'function'; }
}
class Multi { constructor(values) { this.values = values; } }
class Iter { constructor(kind, table) { this.kind = kind; this.table = table; } }
const STOP = Symbol('stop');

export class LunaError extends Error {
  constructor(message, node, file) { super(message); this.node = node; this.file = file; }
}

class Scope {
  constructor(parent, kind = 'block', file = parent?.file) { this.parent = parent; this.kind = kind; this.file = file; this.vars = new Map(); }
  find(name) { for (let s = this; s; s = s.parent) { const b = s.vars.get(name); if (b) return b; } return null; }
  declare(name, kind, value, extra) { const b = { value, kind, init: true, ...extra }; this.vars.set(name, b); return b; }
}

const truthy = (v) => v !== undefined && v !== false && v !== null;

export function typeOf(v) {
  if (v === undefined || v === null) return 'nil';
  const t = typeof v;
  if (t === 'number' || t === 'string' || t === 'boolean') return t;
  return v.lunaType || 'userdata';
}

function fmtNum(n) {
  if (Number.isInteger(n)) return String(n);
  if (n === Infinity) return 'inf';
  if (n === -Infinity) return '-inf';
  if (Number.isNaN(n)) return 'nan';
  return String(+n.toPrecision(14));
}

export function tostring(v, depth = 0) {
  if (v === undefined || v === null) return 'nil';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
  if (typeof v === 'boolean') return String(v);
  if (v instanceof LTable) {
    if (depth > 2) return '{…}';
    const n = v.length();
    const parts = [];
    for (let i = 1; i <= n; i++) parts.push(tostring(v.get(i), depth + 1));
    for (const [k, val] of v.hash) {
      if (typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= n) continue;
      parts.push(`${typeof k === 'string' && /^[A-Za-z_]\w*$/.test(k) ? k : '[' + tostring(k, depth + 1) + ']'} = ${tostring(val, depth + 1)}`);
      if (parts.length > 40) { parts.push('…'); break; }
    }
    return '{' + parts.join(', ') + '}';
  }
  if (v instanceof LFunction || v instanceof Native) return `function: ${v.name}`;
  if (v.lunaToString) return v.lunaToString();
  return v.lunaType || 'userdata';
}

/** JS ↔ Luna (für JSON, Speicher, Http) */
export function toLuna(x) {
  if (x === null || x === undefined) return undefined;
  if (Array.isArray(x)) { const t = new LTable(); x.forEach((v, i) => t.set(i + 1, toLuna(v))); return t; }
  if (typeof x === 'object') { const t = new LTable(); for (const [k, v] of Object.entries(x)) t.set(k, toLuna(v)); return t; }
  return x;
}
export function toJs(v, depth = 0) {
  if (depth > 20) return null;
  if (v instanceof LTable) {
    const n = v.length();
    if (n && n === v.hash.size) return Array.from({ length: n }, (_, i) => toJs(v.get(i + 1), depth + 1));
    const o = {};
    for (const [k, val] of v.hash) o[String(k)] = toJs(val, depth + 1);
    return o;
  }
  if (v === undefined) return null;
  if (typeof v === 'object' || typeof v === 'function') return null;
  return v;
}

const macrotask = (() => {
  const ch = new MessageChannel();
  const q = [];
  ch.port1.onmessage = () => q.shift()?.();
  return () => new Promise((r) => { q.push(r); ch.port2.postMessage(0); });
})();

// Funktionen aus Bibliotheken, die erst nach import verfügbar sind
export const LIB_GLOBALS = { create: 'Html', rgb: 'Html' };
export const LIB_NAMES = { html: 'Html', http: 'Http', storage: 'Storage', discord: 'discord', webhook: 'Webhook' };

// ---------- Interpreter ----------
export class LunaRuntime {
  constructor({ out, stageHost, projectId, onStatus, onStage, webhooks }) {
    this.out = out;
    this.webhooks = webhooks || { list: [], send: async () => { throw new Error('Webhooks sind hier nicht verfügbar.'); } };
    this.stageHost = stageHost;
    this.projectId = projectId;
    this.onStatus = onStatus || (() => {});
    this.onStage = onStage || (() => {});
    this.stopped = false;
    this.steps = 0;
    this.tasks = 0;
    this.listeners = 0;
    this.timers = new Set();
    this.depth = 0;
    this.libCache = new Map();
    this.start = performance.now();
  }

  /** files: [{ path, source }] – alle Luna-Scripts eines Projekts */
  async run(files) {
    const G = (this.G = new Scope(null, 'global', null));
    installBuiltins(this, G);
    const scripts = [];
    for (const f of files) {
      try { scripts.push({ ...f, ast: parse(f.source) }); }
      catch (e) {
        if (e instanceof LunaSyntaxError) { this.report(e.message, { file: f.path, line: lineAt(f.source, e.from) }, 'error'); this.finish('Syntaxfehler'); return false; }
        throw e;
      }
    }
    // 1) Hochziehen: Funktionen und let/const der obersten Ebene sind in allen Scripts sofort bekannt
    for (const s of scripts) {
      s.scope = new Scope(G, 'file', s.path);
      for (const st of s.ast.body) {
        if (st.type === 'FunctionDecl' && st.path.length === 1) {
          const fn = new LFunction(st.func, s.scope, s.path, st.name);
          if (st.local) s.scope.declare(st.name, 'local', fn, { file: s.path, line: st.line });
          else {
            const ex = G.vars.get(st.name);
            if (ex && ex.file && ex.file !== s.path) { this.report(`Die Funktion „${st.name}“ gibt es schon in ${ex.file} (Zeile ${ex.line}).`, { file: s.path, line: st.line }, 'error'); this.finish('Fehler'); return false; }
            G.declare(st.name, 'function', fn, { file: s.path, line: st.line });
          }
          st.hoisted = true;
        } else if (st.type === 'Decl' && st.kind !== 'local') {
          for (const n of st.names) if (!G.vars.has(n.name)) G.declare(n.name, st.kind, undefined, { init: false, hoisted: true, file: s.path, line: st.line });
        }
      }
    }
    // 2) Alle Scripts gleichzeitig starten (wait() pausiert nur das eigene Script)
    this.onStatus('läuft');
    const order = scripts.sort((a, b) => (/(^|\/)main\.luna$/.test(a.path) ? -1 : /(^|\/)main\.luna$/.test(b.path) ? 1 : a.path.localeCompare(b.path)));
    for (const s of order) {
      this.tasks++;
      this.execBlock(s.ast.body, s.scope)
        .then((r) => { if (r && r.k !== 'return') this.report(`${r.k === 'break' ? 'break' : 'continue'} außerhalb einer Schleife.`, { file: s.path }, 'error'); })
        .catch((e) => this.handleError(e, s.path))
        .finally(() => { this.tasks--; this.checkEnd(); });
    }
    return true;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const t of this.timers) { clearTimeout(t.id); t.reject(STOP); }
    this.timers.clear();
    for (const lib of this.libCache.values()) lib.dispose?.();
    this.finish('gestoppt');
  }

  finish(status) { if (!this.done) { this.done = true; this.onStatus(status); } }
  checkEnd() {
    if (this.stopped || this.done) return;
    if (this.tasks === 0 && this.listeners === 0) this.finish('fertig');
    else if (this.tasks === 0) this.onStatus('wartet auf Ereignisse');
  }

  report(text, loc, level = 'error') { this.out(level, text, loc); }
  handleError(e, file) {
    if (e === STOP) return;
    if (e instanceof LunaError) this.report(e.message, { file: e.file || file, line: e.node?.line }, 'error');
    else { console.error(e); this.report('Interner Fehler: ' + (e?.message || e), { file }, 'error'); }
  }

  err(msg, node, scope) { return new LunaError(msg, node, scope?.file); }

  async tick() {
    if (this.stopped) throw STOP;
    if (++this.steps % 4000 === 0) { await macrotask(); if (this.stopped) throw STOP; }
  }

  sleep(seconds) {
    const ms = Math.max(0, (Number(seconds) || 0) * 1000);
    return new Promise((resolve, reject) => {
      const t = { reject };
      t.id = setTimeout(() => { this.timers.delete(t); resolve(); }, ms);
      this.timers.add(t);
    });
  }

  spawn(fn, args = [], file) {
    this.tasks++;
    this.callValue(fn, args, null, 'Ereignis', null)
      .catch((e) => this.handleError(e, file || fn?.file))
      .finally(() => { this.tasks--; this.checkEnd(); });
  }

  // ---------- Anweisungen ----------
  async execBlock(stmts, scope) {
    for (const st of stmts) {
      const r = await this.exec(st, scope);
      if (r) return r;
    }
    return null;
  }

  async exec(st, scope) {
    await this.tick();
    switch (st.type) {
      case 'Decl': {
        const values = await this.evalList(st.values, scope);
        const target = st.kind !== 'local' && scope.kind === 'file' ? this.G : scope;
        st.names.forEach((n, i) => {
          const v = values[i];
          const ex = target.vars.get(n.name);
          if (ex && ex.hoisted && !ex.init) { ex.value = v; ex.init = true; ex.kind = st.kind; ex.file = scope.file; ex.line = st.line; return; }
          if (ex && ex.kind === 'const' && target === this.G) throw this.err(`„${n.name}“ ist schon als const in ${ex.file || 'einem Script'} (Zeile ${ex.line}) festgelegt.`, st, scope);
          target.declare(n.name, st.kind, v, { file: scope.file, line: st.line });
        });
        return null;
      }
      case 'FunctionDecl': {
        if (st.hoisted && scope.kind === 'file') return null;
        const fn = new LFunction(st.func, scope, scope.file, st.name);
        if (st.path.length > 1) {
          let obj = await this.lookup(st.path[0], st, scope);
          for (let i = 1; i < st.path.length - 1; i++) obj = this.index(obj, st.path[i], st, scope);
          this.setIndex(obj, st.path[st.path.length - 1], fn, st, scope);
        } else if (st.local) scope.declare(st.name, 'local', fn, { file: scope.file, line: st.line });
        else this.G.declare(st.name, 'function', fn, { file: scope.file, line: st.line });
        return null;
      }
      case 'Assign': {
        const values = await this.evalList(st.values, scope);
        for (let i = 0; i < st.targets.length; i++) await this.assign(st.targets[i], values[i], scope);
        return null;
      }
      case 'CompoundAssign': {
        const cur = await this.eval(st.target, scope);
        const val = await this.eval(st.value, scope);
        await this.assign(st.target, this.binary(st.op, cur, val, st, scope), scope);
        return null;
      }
      case 'CallStat': await this.call(st.call, scope); return null;
      case 'If': {
        for (const c of st.clauses) {
          if (truthy(await this.eval(c.cond, scope))) return this.execBlock(c.body, new Scope(scope));
        }
        if (st.orelse) return this.execBlock(st.orelse, new Scope(scope));
        return null;
      }
      case 'While': {
        while (truthy(await this.eval(st.cond, scope))) {
          const r = await this.execBlock(st.body, new Scope(scope));
          if (r) { if (r.k === 'break') break; if (r.k === 'return') return r; }
          await this.tick();
        }
        return null;
      }
      case 'Repeat': {
        while (true) {
          const inner = new Scope(scope);
          const r = await this.execBlock(st.body, inner);
          if (r) { if (r.k === 'break') break; if (r.k === 'return') return r; }
          if (truthy(await this.eval(st.cond, inner))) break;
          await this.tick();
        }
        return null;
      }
      case 'NumFor': {
        const num = async (e, what) => {
          const v = await this.eval(e, scope);
          const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
          if (typeof n !== 'number' || Number.isNaN(n)) throw this.err(`for: ${what} muss eine Zahl sein (ist ${typeOf(v)}).`, e, scope);
          return n;
        };
        const start = await num(st.start, 'der Startwert');
        const stop = await num(st.stop, 'das Ziel');
        const step = st.step ? await num(st.step, 'der Schritt') : 1;
        if (step === 0) throw this.err('for: der Schritt darf nicht 0 sein.', st.step, scope);
        for (let i = start; step > 0 ? i <= stop : i >= stop; i += step) {
          const inner = new Scope(scope);
          inner.declare(st.var, 'local', i);
          const r = await this.execBlock(st.body, inner);
          if (r) { if (r.k === 'break') break; if (r.k === 'return') return r; }
          await this.tick();
        }
        return null;
      }
      case 'GenFor': {
        const vals = await this.evalList(st.iter, scope);
        let src = vals[0];
        const run = async (values) => {
          const inner = new Scope(scope);
          st.names.forEach((n, i) => inner.declare(n, 'local', values[i]));
          return this.execBlock(st.body, inner);
        };
        if (src instanceof LTable) src = new Iter('pairs', src);
        if (src instanceof Iter) {
          const entries = src.kind === 'ipairs' ? null : [...src.table.hash.entries()];
          for (let i = 0; ; i++) {
            let pair;
            if (entries) { if (i >= entries.length) break; pair = entries[i]; }
            else { const v = src.table.get(i + 1); if (v === undefined) break; pair = [i + 1, v]; }
            const r = await run(pair);
            if (r) { if (r.k === 'break') break; if (r.k === 'return') return r; }
            await this.tick();
          }
          return null;
        }
        if (src instanceof LFunction || src instanceof Native) {
          let ctl = vals[2];
          while (true) {
            const rs = await this.callValue(src, [vals[1], ctl], st, 'Iterator', scope);
            if (rs[0] === undefined) break;
            ctl = rs[0];
            const r = await run(rs);
            if (r) { if (r.k === 'break') break; if (r.k === 'return') return r; }
            await this.tick();
          }
          return null;
        }
        throw this.err(`for … in: über ${typeOf(src)} kann nicht gezählt werden – nutze pairs(tabelle) oder ipairs(liste).`, st.iter[0], scope);
      }
      case 'Do': return this.execBlock(st.body, new Scope(scope));
      case 'Return': return { k: 'return', v: await this.evalList(st.values, scope) };
      case 'Break': return { k: 'break' };
      case 'Continue': return { k: 'continue' };
      case 'Import': {
        for (const lib of st.libs) this.importLib(lib, scope, st);
        return null;
      }
      default: throw this.err('Unbekannte Anweisung ' + st.type, st, scope);
    }
  }

  importLib(lib, scope, node) {
    const key = lib.name.toLowerCase();
    const factory = LIBRARIES[key];
    if (!factory) throw this.err(`Die Bibliothek „${lib.name}“ gibt es nicht. Verfügbar: ${Object.values(LIB_NAMES).join(', ')}.`, node, scope);
    if (!this.libCache.has(key)) this.libCache.set(key, factory(this));
    const l = this.libCache.get(key);
    scope.declare(lib.name, 'import', l.object);
    for (const [n, v] of Object.entries(l.globals || {})) scope.declare(n, 'import', v);
  }

  async assign(target, value, scope) {
    if (target.type === 'Name') {
      const b = scope.find(target.name);
      if (b) {
        if (b.kind === 'const' && b.init) throw this.err(`„${target.name}“ ist const und kann nicht geändert werden. Benutze let, wenn sich der Wert ändern soll.`, target, scope);
        if (b.kind === 'import') throw this.err(`„${target.name}“ kommt aus einer Bibliothek und kann nicht überschrieben werden.`, target, scope);
        b.value = value; b.init = true;
      } else this.G.declare(target.name, 'let', value, { file: scope.file, line: target.line });
      return;
    }
    const obj = await this.eval(target.obj, scope);
    const key = await this.eval(target.key, scope);
    this.setIndex(obj, key, value, target, scope);
  }

  async lookup(name, node, scope) {
    const b = scope.find(name);
    if (b) return b.value;
    if (LIB_GLOBALS[name]) throw this.err(`„${name}“ gehört zur Bibliothek ${LIB_GLOBALS[name]} – schreibe oben: import ${LIB_GLOBALS[name]}`, node, scope);
    if (LIB_NAMES[name.toLowerCase()]) throw this.err(`„${name}“ ist eine Bibliothek – schreibe oben: import ${LIB_NAMES[name.toLowerCase()]}`, node, scope);
    throw this.err(`„${name}“ ist nicht definiert. Lege es mit local, let oder const an.`, node, scope);
  }

  // ---------- Ausdrücke ----------
  async eval(e, scope) {
    switch (e.type) {
      case 'Number': return e.value;
      case 'String': return e.value;
      case 'Bool': return e.value;
      case 'Nil': return undefined;
      case 'Name': return this.lookup(e.name, e, scope);
      case 'Paren': return this.eval(e.expr, scope);
      case 'Template': {
        let s = '';
        for (const p of e.parts) s += typeof p === 'string' ? p : tostring(await this.eval(p, scope));
        return s;
      }
      case 'Vararg': return scope.find('...')?.value?.[0];
      case 'Function': return new LFunction(e, scope, scope.file);
      case 'Table': {
        const t = new LTable();
        let i = 1;
        for (let k = 0; k < e.fields.length; k++) {
          const f = e.fields[k];
          if (f.key) { t.set(await this.eval(f.key, scope), await this.eval(f.value, scope)); continue; }
          if (k === e.fields.length - 1 && ['Call', 'MethodCall', 'Vararg'].includes(f.value.type)) {
            for (const v of await this.evalMulti(f.value, scope)) t.set(i++, v);
          } else t.set(i++, await this.eval(f.value, scope));
        }
        return t;
      }
      case 'Index': {
        const obj = await this.eval(e.obj, scope);
        const key = await this.eval(e.key, scope);
        return this.index(obj, key, e, scope);
      }
      case 'Call': case 'MethodCall': return (await this.call(e, scope))[0];
      case 'Unary': {
        const v = await this.eval(e.arg, scope);
        if (e.op === 'not') return !truthy(v);
        if (e.op === '-') return -this.num(v, e.arg, scope, 'mit - rechnen');
        if (e.op === '#') {
          if (typeof v === 'string') return v.length;
          if (v instanceof LTable) return v.length();
          if (v?.lunaLength) return v.lunaLength();
          throw this.err(`# (Länge) geht nur bei Texten und Tabellen, nicht bei ${typeOf(v)}.`, e, scope);
        }
        break;
      }
      case 'Binary': {
        if (e.op === 'and') { const l = await this.eval(e.left, scope); return truthy(l) ? this.eval(e.right, scope) : l; }
        if (e.op === 'or') { const l = await this.eval(e.left, scope); return truthy(l) ? l : this.eval(e.right, scope); }
        const l = await this.eval(e.left, scope);
        const r = await this.eval(e.right, scope);
        return this.binary(e.op, l, r, e, scope);
      }
      default: break;
    }
    throw this.err('Unbekannter Ausdruck ' + e.type, e, scope);
  }

  describe(node) {
    if (!node) return 'der Wert';
    if (node.type === 'Name') return `„${node.name}“`;
    if (node.type === 'Index' && node.key.type === 'String') return `„${this.describe(node.obj).replace(/[„“]/g, '')}.${node.key.value}“`;
    return 'der Wert';
  }

  num(v, node, scope, what) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    if (v === undefined) throw this.err(`Kann nicht ${what}: ${this.describe(node)} ist nil.`, node, scope);
    throw this.err(`Kann nicht ${what}: ${this.describe(node)} ist ${typeOf(v)}${typeof v === 'string' ? ` („${v}“)` : ''}, keine Zahl.`, node, scope);
  }

  binary(op, l, r, e, scope) {
    const L = e.left || e.target, R = e.right || e.value;
    switch (op) {
      case '..': {
        if (l === undefined || r === undefined) throw this.err(`Kann nicht verbinden: ${this.describe(l === undefined ? L : R)} ist nil.`, e, scope);
        return tostring(l) + tostring(r);
      }
      case '+':
        if (typeof l === 'string' || typeof r === 'string') {
          if (l === undefined || r === undefined) throw this.err(`Kann nicht verbinden: ${this.describe(l === undefined ? L : R)} ist nil.`, e, scope);
          return tostring(l) + tostring(r);
        }
        return this.num(l, L, scope, 'addieren') + this.num(r, R, scope, 'addieren');
      case '-': return this.num(l, L, scope, 'subtrahieren') - this.num(r, R, scope, 'subtrahieren');
      case '*': return this.num(l, L, scope, 'multiplizieren') * this.num(r, R, scope, 'multiplizieren');
      case '/': return this.num(l, L, scope, 'teilen') / this.num(r, R, scope, 'teilen');
      case '//': return Math.floor(this.num(l, L, scope, 'teilen') / this.num(r, R, scope, 'teilen'));
      case '%': { const a = this.num(l, L, scope, 'Rest bilden'), b = this.num(r, R, scope, 'Rest bilden'); return a - Math.floor(a / b) * b; }
      case '^': return this.num(l, L, scope, 'potenzieren') ** this.num(r, R, scope, 'potenzieren');
      case '==': return l === r;
      case '~=': return l !== r;
      case '<': case '>': case '<=': case '>=': {
        if (!((typeof l === 'number' && typeof r === 'number') || (typeof l === 'string' && typeof r === 'string'))) {
          throw this.err(`Kann ${typeOf(l)} und ${typeOf(r)} nicht mit ${op} vergleichen${l === undefined || r === undefined ? ` (${this.describe(l === undefined ? L : R)} ist nil)` : ''}.`, e, scope);
        }
        return op === '<' ? l < r : op === '>' ? l > r : op === '<=' ? l <= r : l >= r;
      }
      default: throw this.err('Unbekannter Operator ' + op, e, scope);
    }
  }

  index(obj, key, node, scope) {
    if (obj instanceof LTable) return obj.get(key);
    if (typeof obj === 'string') {
      const f = typeof key === 'string' && this.G.vars.get('string')?.value?.get(key);
      if (f) return f;
      throw this.err(`Texte haben kein „${tostring(key)}“.`, node, scope);
    }
    if (obj && obj.lunaGet) {
      const v = obj.lunaGet(String(key), this);
      if (v === NOPE) throw this.err(`${obj.lunaType} hat keine Eigenschaft „${tostring(key)}“.`, node, scope);
      return v;
    }
    if (obj === undefined) throw this.err(`Kann „${tostring(key)}“ nicht lesen – ${this.describe(node.obj)} ist nil.`, node, scope);
    throw this.err(`Kann „${tostring(key)}“ nicht lesen – ${this.describe(node.obj)} ist ${typeOf(obj)}.`, node, scope);
  }

  setIndex(obj, key, value, node, scope) {
    if (obj instanceof LTable) { try { obj.set(key, value); } catch (e) { throw this.err(e.message, node, scope); } return; }
    if (obj && obj.lunaSet) {
      const ok = obj.lunaSet(String(key), value, this);
      if (ok === NOPE) throw this.err(`${obj.lunaType} hat keine Eigenschaft „${tostring(key)}“, die man setzen kann.`, node, scope);
      return;
    }
    throw this.err(`Kann „${tostring(key)}“ nicht setzen – ${this.describe(node?.obj)} ist ${typeOf(obj)}.`, node, scope);
  }

  async evalMulti(e, scope) {
    if (e.type === 'Call' || e.type === 'MethodCall') return this.call(e, scope);
    if (e.type === 'Vararg') return scope.find('...')?.value || [];
    return [await this.eval(e, scope)];
  }

  async evalList(list, scope) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (i === list.length - 1) out.push(...(await this.evalMulti(list[i], scope)));
      else out.push(await this.eval(list[i], scope));
    }
    return out;
  }

  async call(e, scope) {
    if (e.type === 'MethodCall') {
      const obj = await this.eval(e.obj, scope);
      const fn = this.index(obj, e.method, { ...e, obj: e.obj }, scope);
      const args = await this.evalList(e.args, scope);
      return this.callValue(fn, [obj, ...args], e, e.method, scope);
    }
    const fn = await this.eval(e.fn, scope);
    const args = await this.evalList(e.args, scope);
    return this.callValue(fn, args, e, e.fn.type === 'Name' ? e.fn.name : e.fn.type === 'Index' && e.fn.key.type === 'String' ? e.fn.key.value : 'Funktion', scope);
  }

  async callValue(fn, args, node, name, scope) {
    if (fn instanceof LFunction) {
      if (++this.depth > 180) { this.depth = 0; throw this.err('Zu viele verschachtelte Aufrufe – ruft sich eine Funktion endlos selbst auf?', node, scope); }
      try {
        const f = fn.node;
        const s = new Scope(fn.closure, 'function', fn.file);
        const params = f.method ? ['self', ...f.params] : f.params;
        params.forEach((p, i) => s.declare(p, 'local', args[i]));
        if (f.vararg) s.declare('...', 'local', args.slice(params.length));
        const r = await this.execBlock(f.body, s);
        if (r?.k === 'return') return r.v;
        if (r) throw this.err(`${r.k} außerhalb einer Schleife.`, f, s);
        return [];
      } finally { this.depth--; }
    }
    if (fn instanceof Native) {
      let r;
      try { r = await fn.fn(args, { rt: this, node, scope, file: scope?.file }); }
      catch (e) {
        if (e === STOP || e instanceof LunaError) throw e;
        throw this.err(`${fn.name}: ${e.message}`, node, scope);
      }
      if (r instanceof Multi) return r.values;
      return r === undefined ? [] : [r];
    }
    if (fn === undefined) throw this.err(`„${name}“ ist nil und kann nicht aufgerufen werden.`, node, scope);
    throw this.err(`„${name}“ ist ${typeOf(fn)} und keine Funktion.`, node, scope);
  }
}

export const NOPE = Symbol('nope');
const nat = (name, fn) => new Native(name, fn);
const str = (v) => (typeof v === 'string' ? v : tostring(v));
const tableOf = (entries) => { const t = new LTable(); for (const [k, v] of Object.entries(entries)) t.set(k, v); return t; };
const needTable = (t, fn) => { if (!(t instanceof LTable)) throw new Error(`erwartet eine Tabelle, bekommen: ${typeOf(t)}`); return t; };

// ---------- Eingebaute Funktionen (wie Luau) ----------
function installBuiltins(rt, G) {
  const def = (name, fn) => G.declare(name, 'builtin', nat(name, fn));
  const loc = (ctx) => ({ file: ctx.file, line: ctx.node?.line });
  def('print', (args, ctx) => { rt.out('log', args.map((a) => tostring(a)).join(' '), loc(ctx)); });
  def('warn', (args, ctx) => { rt.out('warn', args.map((a) => tostring(a)).join(' '), loc(ctx)); });
  def('error', (args, ctx) => { throw new LunaError(tostring(args[0] ?? 'Fehler'), ctx.node, ctx.file); });
  def('assert', (args, ctx) => { if (!truthy(args[0])) throw new LunaError(tostring(args[1] ?? 'assert fehlgeschlagen'), ctx.node, ctx.file); return new Multi(args); });
  def('wait', async (args) => { const t0 = performance.now(); await rt.sleep(args[0] ?? 0.03); return (performance.now() - t0) / 1000; });
  def('spawn', (args, ctx) => { rt.spawn(args[0], args.slice(1), ctx.file); });
  def('delay', (args, ctx) => { rt.tasks++; rt.sleep(args[0]).then(() => rt.spawn(args[1], [], ctx.file)).catch(() => {}).finally(() => { rt.tasks--; rt.checkEnd(); }); });
  def('typeof', (args) => typeOf(args[0]));
  def('type', (args) => { const t = typeOf(args[0]); return ['nil', 'number', 'string', 'boolean', 'table', 'function'].includes(t) ? t : 'userdata'; });
  def('tostring', (args) => tostring(args[0]));
  def('tonumber', (args) => {
    const v = args[0];
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return undefined;
    const n = args[1] ? parseInt(v, args[1]) : Number(v.trim());
    return v.trim() === '' || Number.isNaN(n) ? undefined : n;
  });
  def('pairs', (args) => new Multi([new Iter('pairs', needTable(args[0]))]));
  def('ipairs', (args) => new Multi([new Iter('ipairs', needTable(args[0]))]));
  def('time', () => Date.now() / 1000);
  def('clock', () => (performance.now() - rt.start) / 1000);

  const lib = (name, fns, extra = {}) => {
    const t = new LTable();
    for (const [k, fn] of Object.entries(fns)) t.set(k, nat(`${name}.${k}`, fn));
    for (const [k, v] of Object.entries(extra)) t.set(k, v);
    G.declare(name, 'builtin', t);
  };
  const n = (v, what = 'Zahl') => { if (typeof v !== 'number') { const x = Number(v); if (typeof v !== 'string' || Number.isNaN(x)) throw new Error(`erwartet eine ${what}, bekommen: ${typeOf(v)}`); return x; } return v; };
  lib('math', {
    abs: ([x]) => Math.abs(n(x)), floor: ([x]) => Math.floor(n(x)), ceil: ([x]) => Math.ceil(n(x)),
    round: ([x, d]) => { const f = 10 ** (d ? n(d) : 0); return Math.round(n(x) * f) / f; },
    sqrt: ([x]) => Math.sqrt(n(x)), pow: ([a, b]) => n(a) ** n(b), sign: ([x]) => Math.sign(n(x)),
    min: (a) => Math.min(...a.map((x) => n(x))), max: (a) => Math.max(...a.map((x) => n(x))),
    clamp: ([x, a, b]) => Math.min(n(b), Math.max(n(a), n(x))),
    random: ([a, b]) => (a === undefined ? Math.random() : b === undefined ? 1 + Math.floor(Math.random() * n(a)) : n(a) + Math.floor(Math.random() * (n(b) - n(a) + 1))),
    sin: ([x]) => Math.sin(n(x)), cos: ([x]) => Math.cos(n(x)), tan: ([x]) => Math.tan(n(x)), log: ([x, b]) => (b ? Math.log(n(x)) / Math.log(n(b)) : Math.log(n(x))),
  }, { pi: Math.PI, huge: Infinity });

  const s = (v) => { if (typeof v === 'number') return fmtNum(v); if (typeof v !== 'string') throw new Error(`erwartet einen Text, bekommen: ${typeOf(v)}`); return v; };
  const idx = (i, len, def) => { if (i === undefined) return def; i = n(i); return i < 0 ? Math.max(len + i + 1, 1) : i; };
  lib('string', {
    len: ([x]) => s(x).length,
    upper: ([x]) => s(x).toUpperCase(),
    lower: ([x]) => s(x).toLowerCase(),
    sub: ([x, i, j]) => { x = s(x); const a = idx(i, x.length, 1), b = Math.min(idx(j, x.length, x.length), x.length); return a > b ? '' : x.slice(a - 1, b); },
    rep: ([x, k, sep = '']) => Array(Math.max(0, n(k))).fill(s(x)).join(s(sep)),
    reverse: ([x]) => [...s(x)].reverse().join(''),
    trim: ([x]) => s(x).trim(),
    split: ([x, sep = ',']) => { const t = new LTable(); s(x).split(s(sep)).forEach((p, i) => t.set(i + 1, p)); return t; },
    find: ([x, p, init = 1]) => { const i = s(x).indexOf(s(p), n(init) - 1); return i < 0 ? undefined : new Multi([i + 1, i + s(p).length]); },
    contains: ([x, p]) => s(x).includes(s(p)),
    startsWith: ([x, p]) => s(x).startsWith(s(p)),
    endsWith: ([x, p]) => s(x).endsWith(s(p)),
    replace: ([x, a, b]) => s(x).split(s(a)).join(s(b)),
    format: ([fmt, ...args]) => {
      let k = 0;
      return s(fmt).replace(/%(-?\d*)(?:\.(\d+))?([sdifx%])/g, (m, w, prec, c) => {
        if (c === '%') return '%';
        const v = args[k++];
        let out = c === 's' ? tostring(v) : c === 'x' ? Math.floor(n(v)).toString(16) : c === 'f' ? n(v).toFixed(prec ? +prec : 6) : String(Math.trunc(n(v)));
        if (w) out = +w < 0 ? out.padEnd(-w) : out.padStart(+w);
        return out;
      });
    },
  });
  lib('table', {
    insert: (a) => { const t = needTable(a[0]); if (a.length >= 3) { const pos = n(a[1]); const len = t.length(); for (let i = len; i >= pos; i--) t.set(i + 1, t.get(i)); t.set(pos, a[2]); } else t.set(t.length() + 1, a[1]); },
    remove: ([t, pos]) => { needTable(t); const len = t.length(); const p = pos === undefined ? len : n(pos); const v = t.get(p); for (let i = p; i < len; i++) t.set(i, t.get(i + 1)); if (p <= len) t.set(len, undefined); return v; },
    concat: ([t, sep = '']) => { needTable(t); const out = []; for (let i = 1; i <= t.length(); i++) out.push(tostring(t.get(i))); return out.join(s(sep)); },
    find: ([t, v]) => { needTable(t); for (let i = 1; i <= t.length(); i++) if (t.get(i) === v) return i; return undefined; },
    count: ([t]) => needTable(t).hash.size,
    clear: ([t]) => { needTable(t).hash.clear(); },
    sort: async ([t, cmp], ctx) => {
      needTable(t);
      const arr = Array.from({ length: t.length() }, (_, i) => t.get(i + 1));
      const less = async (a, b) => (cmp ? truthy((await rt.callValue(cmp, [a, b], ctx.node, 'Vergleich', ctx.scope))[0]) : a < b);
      const msort = async (xs) => {
        if (xs.length < 2) return xs;
        const mid = xs.length >> 1;
        const a = await msort(xs.slice(0, mid)), b = await msort(xs.slice(mid));
        const out = [];
        while (a.length && b.length) out.push((await less(b[0], a[0])) ? b.shift() : a.shift());
        return out.concat(a, b);
      };
      (await msort(arr)).forEach((v, i) => t.set(i + 1, v));
    },
  });
}

// ---------- Ereignisse ----------
class LEvent {
  constructor(rt, name) { this.rt = rt; this.name = name; this.handlers = new Set(); this.waiters = []; }
  get lunaType() { return 'Event'; }
  lunaToString() { return `Event ${this.name}`; }
  lunaGet(key) {
    const k = key.toLowerCase();
    if (k === 'connectto' || k === 'connect') {
      return nat('ConnectTo', ([self, fn]) => {
        if (!(fn instanceof LFunction || fn instanceof Native)) throw new Error('ConnectTo braucht eine Funktion, z. B. :ConnectTo(function() … end)');
        self.handlers.add(fn);
        this.rt.listeners++;
        return new Connection(this, fn);
      });
    }
    if (k === 'wait') return nat('Wait', ([self]) => new Promise((r) => self.waiters.push(r)).then((args) => new Multi(args)));
    if (k === 'fire') return nat('Fire', ([self, ...args]) => self.fire(args));
    return NOPE;
  }
  fire(args) {
    if (this.rt.stopped) return;
    for (const fn of [...this.handlers]) this.rt.spawn(fn, args);
    this.waiters.splice(0).forEach((r) => r(args));
  }
}
class Connection {
  constructor(ev, fn) { this.ev = ev; this.fn = fn; this.connected = true; }
  get lunaType() { return 'Connection'; }
  lunaGet(key) {
    const k = key.toLowerCase();
    if (k === 'disconnect') return nat('Disconnect', () => { if (this.connected) { this.connected = false; this.ev.handlers.delete(this.fn); this.ev.rt.listeners--; this.ev.rt.checkEnd(); } });
    if (k === 'connected') return this.connected;
    return NOPE;
  }
}

// ---------- 2D-Oberfläche (import Html) ----------
const STAGE_CSS = `
:host { all: initial; }
.stage { position: relative; min-height: 100%; box-sizing: border-box; padding: 18px; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 12px;
  font: 15px/1.4 Inter, system-ui, sans-serif; color: #e8e9ee; background: #101116; }
.el { box-sizing: border-box; font: inherit; }
.btn { padding: 10px 18px; border: 0; border-radius: 10px; background: #3574f0; color: #fff; font-weight: 600; cursor: pointer; transition: filter .12s, transform .06s; }
.btn:hover { filter: brightness(1.1); } .btn:active { transform: scale(.97); }
.text { padding: 4px 2px; }
.input { padding: 9px 12px; border-radius: 9px; border: 1px solid #2c2e37; background: #17181f; color: inherit; outline: none; min-width: 180px; }
.input:focus { border-color: #3574f0; }
.toggle { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; background: none; border: 0; color: inherit; padding: 4px; }
.toggle .track { width: 44px; height: 24px; border-radius: 12px; background: #2a2c36; position: relative; transition: background .15s; }
.toggle .knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; }
.toggle.on .track { background: #3574f0; } .toggle.on .knob { transform: translateX(20px); }
.frame { display: flex; flex-wrap: wrap; gap: 10px; padding: 14px; border-radius: 12px; background: #181920; border: 1px solid #262833; min-width: 60px; min-height: 40px; }
.image { max-width: 100%; border-radius: 8px; }
.slider { accent-color: #3574f0; min-width: 180px; }
.abs { position: absolute; }
.chat { flex-basis: 100%; display: flex; flex-direction: column; border: 1px solid #2c2f3a; border-radius: 12px; overflow: hidden; background: #313338; max-width: 520px; }
.chat-head { padding: 10px 14px; font-weight: 700; background: #2b2d31; color: #f2f3f5; font-size: 14px; }
.chat-head small { font-weight: 500; color: #949ba4; margin-left: 6px; }
.chat-log { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; max-height: 260px; min-height: 90px; overflow: auto; }
.msg b { color: #f2f3f5; margin-right: 6px; } .msg.bot b { color: #949cf7; } .msg { color: #dbdee1; font-size: 14px; }
.chat-in { margin: 0 12px 12px; padding: 10px 12px; border-radius: 8px; border: 0; background: #383a40; color: #dbdee1; font: inherit; outline: none; }
`;

const TYPES = {
  button: 'Button', text: 'Text', label: 'Text', textlabel: 'Text', textbox: 'TextBox', input: 'TextBox',
  toggle: 'Toggle', toggler: 'Toggle', switch: 'Toggle', frame: 'Frame', box: 'Frame', image: 'Image', imagelabel: 'Image', slider: 'Slider',
};
export const UI_TYPES = ['Button', 'Text', 'TextBox', 'Toggle', 'Frame', 'Image', 'Slider'];

class UIStage {
  constructor(rt) {
    this.rt = rt;
    const host = rt.stageHost;
    this.shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `<style>${STAGE_CSS}</style><div class="stage"></div>`;
    this.root = this.shadow.querySelector('.stage');
    rt.onStage();
  }
}

class UIElement {
  constructor(rt, type) {
    this.rt = rt;
    this.type = type;
    this.events = new Map();
    this.props = { name: type };
    const d = document;
    if (type === 'Button') { this.el = d.createElement('button'); this.el.className = 'el btn'; this.el.textContent = 'Button'; }
    else if (type === 'Text') { this.el = d.createElement('div'); this.el.className = 'el text'; this.el.textContent = 'Text'; }
    else if (type === 'TextBox') { this.el = d.createElement('input'); this.el.className = 'el input'; this.el.placeholder = 'Text eingeben …'; }
    else if (type === 'Toggle') {
      this.el = d.createElement('button'); this.el.className = 'el toggle'; this.el.setAttribute('role', 'switch');
      this.el.innerHTML = '<span class="track"><span class="knob"></span></span><span class="lbl"></span>';
      this.checked = false;
      this.el.addEventListener('click', () => { this.setChecked(!this.checked); this.emit('changed', [this.checked]); });
    } else if (type === 'Frame') { this.el = d.createElement('div'); this.el.className = 'el frame'; }
    else if (type === 'Image') { this.el = d.createElement('img'); this.el.className = 'el image'; this.el.alt = ''; }
    else if (type === 'Slider') { this.el = d.createElement('input'); this.el.type = 'range'; this.el.className = 'el slider'; this.el.min = 0; this.el.max = 100; this.el.value = 50; }
    if (type === 'TextBox') {
      this.el.addEventListener('input', () => this.emit('changed', [this.el.value]));
      this.el.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.emit('submit', [this.el.value]); });
    }
    if (type === 'Slider') this.el.addEventListener('input', () => this.emit('changed', [Number(this.el.value)]));
    rt.ui.root.append(this.el);
  }
  get lunaType() { return this.type; }
  lunaToString() { return this.type; }
  setChecked(v) { this.checked = !!v; this.el.classList.toggle('on', this.checked); this.el.setAttribute('aria-checked', String(this.checked)); }
  event(name) {
    if (!this.events.has(name)) {
      const ev = new LEvent(this.rt, name);
      this.events.set(name, ev);
      const dom = { click: 'click', mouseenter: 'mouseenter', mouseleave: 'mouseleave' }[name];
      if (dom) this.el.addEventListener(dom, () => ev.fire(name === 'click' && this.type === 'Toggle' ? [this.checked] : []));
    }
    return this.events.get(name);
  }
  emit(name, args) { this.events.get(name)?.fire(args); }
  textNode() { return this.type === 'Toggle' ? this.el.querySelector('.lbl') : this.el; }
  lunaGet(key) {
    const k = key.toLowerCase();
    switch (k) {
      case 'innertext': case 'text':
        return this.type === 'TextBox' ? this.el.value : this.textNode().textContent;
      case 'value': return this.type === 'Toggle' ? this.checked : this.type === 'Slider' ? Number(this.el.value) : this.type === 'TextBox' ? this.el.value : NOPE;
      case 'checked': return this.type === 'Toggle' ? this.checked : NOPE;
      case 'placeholder': return this.type === 'TextBox' ? this.el.placeholder : NOPE;
      case 'min': case 'max': return this.type === 'Slider' ? Number(this.el[k]) : NOPE;
      case 'src': case 'image': return this.type === 'Image' ? this.el.src : NOPE;
      case 'textcolor': case 'color': return this.el.style.color || undefined;
      case 'background': case 'backgroundcolor': return this.el.style.background || undefined;
      case 'width': case 'height': case 'fontsize': case 'x': case 'y': case 'radius': return this.props[k];
      case 'visible': return this.el.style.display !== 'none';
      case 'enabled': return !this.el.disabled;
      case 'name': return this.props.name;
      case 'parent': return this.parent;
      case 'click': case 'changed': case 'submit': case 'mouseenter': case 'mouseleave': return this.event(k);
      case 'destroy': case 'remove': return nat('Destroy', () => { this.el.remove(); for (const ev of this.events.values()) { this.rt.listeners -= ev.handlers.size; ev.handlers.clear(); } this.rt.checkEnd(); });
      default: return NOPE;
    }
  }
  lunaSet(key, v) {
    const k = key.toLowerCase();
    const px = (x) => (typeof x === 'number' ? x + 'px' : String(x ?? ''));
    switch (k) {
      case 'innertext': case 'text':
        if (this.type === 'TextBox') this.el.value = tostring(v); else this.textNode().textContent = tostring(v);
        return;
      case 'value':
        if (this.type === 'Toggle') { this.setChecked(truthy(v)); return; }
        if (this.type === 'Slider' || this.type === 'TextBox') { this.el.value = tostring(v); return; }
        return NOPE;
      case 'checked': if (this.type !== 'Toggle') return NOPE; this.setChecked(truthy(v)); return;
      case 'placeholder': if (this.type !== 'TextBox') return NOPE; this.el.placeholder = tostring(v); return;
      case 'min': case 'max': if (this.type !== 'Slider') return NOPE; this.el[k] = tostring(v); return;
      case 'src': case 'image': if (this.type !== 'Image') return NOPE; this.el.src = tostring(v); return;
      case 'textcolor': case 'color': this.el.style.color = tostring(v); return;
      case 'background': case 'backgroundcolor': this.el.style.background = tostring(v); return;
      case 'width': this.props.width = v; this.el.style.width = px(v); return;
      case 'height': this.props.height = v; this.el.style.height = px(v); return;
      case 'fontsize': this.props.fontsize = v; this.el.style.fontSize = px(v); return;
      case 'radius': this.props.radius = v; this.el.style.borderRadius = px(v); return;
      case 'x': case 'y':
        this.props[k] = v; this.el.classList.add('abs');
        this.el.style[k === 'x' ? 'left' : 'top'] = px(v);
        return;
      case 'visible': this.el.style.display = truthy(v) ? '' : 'none'; return;
      case 'enabled': this.el.disabled = !truthy(v); return;
      case 'bold': this.el.style.fontWeight = truthy(v) ? '700' : ''; return;
      case 'name': this.props.name = tostring(v); return;
      case 'parent':
        if (v === undefined) { this.parent = undefined; this.rt.ui.root.append(this.el); return; }
        if (!(v instanceof UIElement) || v.type !== 'Frame') throw new Error('parent muss ein Frame sein (oder nil).');
        this.parent = v; v.el.append(this.el); return;
      default: return NOPE;
    }
  }
}

class Library {
  constructor(name, members, dispose) { this.name = name; this.members = members; this.dispose = dispose; }
  get lunaType() { return 'Library'; }
  lunaToString() { return 'Bibliothek ' + this.name; }
  lunaGet(key) { return key in this.members ? this.members[key] : (this.members[Object.keys(this.members).find((m) => m.toLowerCase() === key.toLowerCase())] ?? NOPE); }
  lunaSet() { return NOPE; }
}

const LIBRARIES = {
  html(rt) {
    rt.ui = rt.ui || new UIStage(rt);
    const create = nat('create', ([type]) => {
      const t = TYPES[String(type ?? '').toLowerCase()];
      if (!t) throw new Error(`„${tostring(type)}“ kann nicht erstellt werden. Möglich: ${UI_TYPES.join(', ')}.`);
      return new UIElement(rt, t);
    });
    const rgb = nat('rgb', ([r, g, b]) => `rgb(${Number(r) || 0}, ${Number(g) || 0}, ${Number(b) || 0})`);
    const title = nat('title', ([t]) => { const h = document.createElement('h2'); h.style.cssText = 'flex-basis:100%;margin:0 0 4px;font-size:22px'; h.textContent = tostring(t); rt.ui.root.append(h); });
    const clear = nat('clear', () => { rt.ui.root.replaceChildren(); });
    return { object: new Library('Html', { create, rgb, title, clear }), globals: { create, rgb } };
  },
  http(rt) {
    const get = nat('Http.get', async ([url]) => { const r = await fetch(tostring(url)); if (!r.ok) throw new Error(`Antwort ${r.status}`); return r.text(); });
    const json = nat('Http.json', async ([url]) => { const r = await fetch(tostring(url)); if (!r.ok) throw new Error(`Antwort ${r.status}`); return toLuna(await r.json()); });
    return { object: new Library('Http', { get, json }) };
  },
  storage(rt) {
    const key = (k) => `luna.storage.${rt.projectId}.${tostring(k)}`;
    const save = nat('Storage.save', ([k, v]) => { localStorage.setItem(key(k), JSON.stringify(toJs(v))); });
    const load = nat('Storage.load', ([k, d]) => { const raw = localStorage.getItem(key(k)); return raw == null ? d : toLuna(JSON.parse(raw)); });
    const remove = nat('Storage.remove', ([k]) => { localStorage.removeItem(key(k)); });
    return { object: new Library('Storage', { save, load, remove }) };
  },
  webhook(rt) {
    const find = (name) => {
      const w = rt.webhooks.list.find((x) => x.name.toLowerCase() === tostring(name).toLowerCase());
      if (!w) throw new Error(`Webhook „${tostring(name)}“ gibt es nicht – lege ihn im Dashboard unter „Webhooks“ an.`);
      return w;
    };
    const send = nat('Webhook.send', async ([name, data]) => { await rt.webhooks.send(find(name), typeof data === 'string' ? data : toJs(data)); return true; });
    const list = nat('Webhook.list', () => toLuna(rt.webhooks.list.map((w) => w.name)));
    const exists = nat('Webhook.exists', ([name]) => rt.webhooks.list.some((x) => x.name.toLowerCase() === tostring(name).toLowerCase()));
    return { object: new Library('Webhook', { send, list, exists }) };
  },
  discord(rt) {
    rt.ui = rt.ui || new UIStage(rt);
    const box = document.createElement('div');
    box.className = 'chat';
    box.innerHTML = '<div class="chat-head"># allgemein<small>Discord – Simulation</small></div><div class="chat-log"></div><input class="chat-in" placeholder="Nachricht an #allgemein (z. B. !ping)">';
    rt.ui.root.append(box);
    const log = box.querySelector('.chat-log');
    let botName = 'Luna-Bot';
    const add = (author, text, bot) => {
      const m = document.createElement('div');
      m.className = 'msg' + (bot ? ' bot' : '');
      const b = document.createElement('b'); b.textContent = author;
      m.append(b, document.createTextNode(text));
      log.append(m); log.scrollTop = log.scrollHeight;
    };
    const message = new LEvent(rt, 'message');
    const send = nat('discord.send', ([text]) => { add(botName, tostring(text), true); });
    box.querySelector('.chat-in').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.value.trim()) return;
      const text = e.target.value; e.target.value = '';
      add('Du', text, false);
      const msg = tableOf({ content: text, author: 'Du', channel: 'allgemein' });
      msg.set('reply', nat('reply', ([, t]) => add(botName, tostring(t), true)));
      message.fire([msg]);
    });
    const lib = new Library('discord', { send, message });
    lib.lunaSet = (k, v) => { if (k.toLowerCase() === 'name') { botName = tostring(v); return; } return NOPE; };
    const get = lib.lunaGet.bind(lib);
    lib.lunaGet = (k) => (k.toLowerCase() === 'name' ? botName : get(k));
    return { object: lib };
  },
};
