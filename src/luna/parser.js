// Luna – Lexer & Parser.
// Luna ist wie Luau, aber für alle:
//   local x = 1        nur in dieser Datei
//   let x = 1          überall änderbar und aufrufbar
//   const x = 1        überall aufrufbar, nicht änderbar
//   function f() … end)        Funktionen enden IMMER mit end)
//   if … then … else … end     if/else/Schleifen enden mit end (ohne Klammer)
//   import Html                Bibliothek hinzufügen

export const KEYWORDS = new Set([
  'and', 'break', 'const', 'continue', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'import',
  'in', 'let', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

export class LunaSyntaxError extends Error {
  constructor(message, from, to, code = 'syntax') {
    super(message);
    this.from = from;
    this.to = Math.max(to ?? from + 1, from + 1);
    this.code = code;
  }
}

const OPS3 = ['...', '..=', '//='];
const OPS2 = ['..', '==', '~=', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '^=', '//', '::'];
const OPS1 = '+-*/%^#<>=(){}[];:,.';

// ---------- Lexer ----------
export function tokenize(src) {
  const tokens = [];
  const warnings = [];
  let i = 0;
  const n = src.length;
  const push = (t, v, from, extra) => tokens.push({ t, v, from, to: i, ...extra });

  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f') { i++; continue; }

    // Kommentare: --[[ … ]]  |  -- bis Zeilenende  |  -- mitten in der Zeile --
    if (c === '-' && src[i + 1] === '-') {
      const start = i;
      const long = /^--\[(=*)\[/.exec(src.slice(i, i + 20));
      if (long) {
        const close = ']' + long[1] + ']';
        const end = src.indexOf(close, i + long[0].length);
        if (end < 0) throw new LunaSyntaxError('Block-Kommentar --[[ wurde nicht mit ]] geschlossen.', start, start + 4, 'missing-end');
        i = end + close.length;
        continue;
      }
      let eol = src.indexOf('\n', i);
      if (eol < 0) eol = n;
      const inner = src.indexOf('--', i + 2);
      if (inner >= 0 && inner < eol && src.slice(inner + 2, eol).trim()) i = inner + 2; // Inline-Kommentar
      else i = eol;
      continue;
    }

    // Zahlen
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const start = i;
      let m;
      if ((m = /^0[xX][0-9a-fA-F_]+/.exec(src.slice(i, i + 40)))) i += m[0].length;
      else { m = /^(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i, i + 80)); i += m[0].length; }
      const text = src.slice(start, i).replace(/_/g, '');
      const v = Number(text);
      if (Number.isNaN(v)) throw new LunaSyntaxError(`Ungültige Zahl „${src.slice(start, i)}“.`, start, i);
      push('num', v, start);
      continue;
    }

    // Namen & Schlüsselwörter (end) wird als eigenes Zeichen erkannt)
    if (/[A-Za-z_À-ɏ]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_À-ɏ]/.test(src[i])) i++;
      const word = src.slice(start, i);
      if (word === 'end' && src[i] === ')') { i++; push('kw', 'end)', start); continue; }
      push(KEYWORDS.has(word) ? 'kw' : 'name', word, start);
      continue;
    }

    // Texte: "…" und `…` mit {Platzhaltern}, '…' ohne
    if (c === '"' || c === "'" || c === '`') {
      const start = i;
      const quote = c;
      i++;
      let buf = '';
      const parts = [];
      while (true) {
        if (i >= n || src[i] === '\n') throw new LunaSyntaxError('Text wurde nicht geschlossen – es fehlt ' + quote, start, i, 'string');
        const ch = src[i];
        if (ch === quote) { i++; break; }
        if (ch === '\\') {
          const e = src[i + 1];
          const map = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'", '`': '`', '{': '{', '}': '}' };
          if (e in map) { buf += map[e]; i += 2; continue; }
          if (e === '\n') { buf += '\n'; i += 2; continue; }
          buf += e ?? ''; i += 2; continue;
        }
        if (ch === '{' && quote !== "'") {
          // Platzhalter {ausdruck}
          let depth = 1, j = i + 1;
          while (j < n && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; else if (src[j] === '\n') break; if (depth) j++; }
          if (depth) throw new LunaSyntaxError('Platzhalter { wurde nicht mit } geschlossen.', i, i + 1, 'string');
          if (buf) parts.push(buf);
          buf = '';
          parts.push({ code: src.slice(i + 1, j), from: i + 1 });
          i = j + 1;
          continue;
        }
        buf += ch; i++;
      }
      if (parts.length) { if (buf) parts.push(buf); push('str', null, start, { parts }); }
      else push('str', buf, start);
      continue;
    }
    // Lange Texte [[ … ]]
    if (c === '[' && /^\[=*\[/.test(src.slice(i, i + 10))) {
      const start = i;
      const lvl = /^\[(=*)\[/.exec(src.slice(i, i + 10))[1];
      const close = ']' + lvl + ']';
      const end = src.indexOf(close, i);
      if (end < 0) throw new LunaSyntaxError('Langer Text [[ wurde nicht mit ]] geschlossen.', start, start + 2, 'missing-end');
      let body = src.slice(i + lvl.length + 2, end);
      if (body.startsWith('\n')) body = body.slice(1);
      i = end + close.length;
      push('str', body, start);
      continue;
    }

    const start = i;
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    if (OPS3.includes(three)) { i += 3; push('op', three, start); continue; }
    if (OPS2.includes(two)) { i += 2; push('op', two, start); continue; }
    if (OPS1.includes(c)) { i++; push('op', c, start); continue; }
    throw new LunaSyntaxError(`Unbekanntes Zeichen „${c}“.`, i, i + 1);
  }
  tokens.push({ t: 'eof', v: '<Ende>', from: n, to: n });
  return { tokens, warnings };
}

// ---------- Parser ----------
const BINARY = {
  or: [1, 1], and: [2, 2],
  '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '==': [3, 3], '~=': [3, 3], '!=': [3, 3],
  '..': [9, 8], '+': [10, 10], '-': [10, 10], '*': [11, 11], '/': [11, 11], '//': [11, 11], '%': [11, 11], '^': [14, 13],
};
const UNARY_PRIO = 12;
const COMPOUND = new Set(['+=', '-=', '*=', '/=', '%=', '^=', '..=', '//=']);
const BLOCK_END = new Set(['end', 'end)', 'else', 'elseif', 'until']);
const LOOPS = new Set(['while', 'for', 'do']);

export function parse(src) {
  const { tokens } = tokenize(src);
  const p = new Parser(src, tokens);
  const body = p.block();
  if (p.tok.t !== 'eof') p.unexpected();
  return { type: 'Chunk', body, from: 0, to: src.length, warnings: p.warnings };
}

class Parser {
  constructor(src, tokens) {
    this.src = src;
    this.tokens = tokens;
    this.i = 0;
    this.warnings = [];
    this.lineStarts = [0];
    for (let k = 0; k < src.length; k++) if (src[k] === '\n') this.lineStarts.push(k + 1);
  }
  get tok() { return this.tokens[this.i]; }
  peek(o = 1) { return this.tokens[Math.min(this.i + o, this.tokens.length - 1)]; }
  next() { const t = this.tokens[this.i]; if (this.i < this.tokens.length - 1) this.i++; return t; }
  is(t, v) { const k = this.tok; return k.t === t && (v === undefined || k.v === v); }
  isOp(v) { return this.is('op', v); }
  isKw(v) { return this.is('kw', v); }
  accept(t, v) { if (this.is(t, v)) return this.next(); return null; }
  lineOf(pos) {
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  }
  desc(t) { return t.t === 'eof' ? 'das Dateiende' : t.t === 'str' ? 'einen Text' : t.t === 'num' ? `die Zahl ${t.v}` : `„${t.v}“`; }
  fail(msg, t = this.tok, code) { throw new LunaSyntaxError(msg, t.from, t.to, code); }
  unexpected(expected) {
    const t = this.tok;
    if (t.t === 'kw' && t.v === 'end)') this.fail('end) gehört zu einer Funktion – hier ist keine Funktion offen. if/else/Schleifen enden mit end (ohne Klammer).', t, 'stray-end');
    if (t.t === 'kw' && t.v === 'end') this.fail('Hier ist kein Block offen, den end schließen könnte.', t, 'stray-end');
    if (t.t === 'kw' && (t.v === 'else' || t.v === 'elseif')) this.fail(`${t.v} ohne passendes if … then.`, t);
    if (t.t === 'kw' && t.v === 'until') this.fail('until ohne passendes repeat.', t);
    if (t.t === 'op' && t.v === ')') this.fail('Unerwartetes ) – Hinweis: end) schließt bei function(…) auch schon die Klammer des Aufrufs.', t);
    this.fail(expected ? `Erwartet ${expected}, gefunden ${this.desc(t)}.` : `Unerwartet: ${this.desc(t)}.`, t);
  }
  expectOp(v, what) { if (this.isOp(v)) return this.next(); this.unexpected(what || `„${v}“`); }
  expectKw(v, what) { if (this.isKw(v)) return this.next(); this.unexpected(what || `„${v}“`); }
  name(what = 'einen Namen') {
    if (this.tok.t === 'name') return this.next();
    if (this.tok.t === 'kw' && !['end', 'end)'].includes(this.tok.v)) this.fail(`„${this.tok.v}“ ist ein Schlüsselwort und kann nicht als Name benutzt werden.`);
    this.unexpected(what);
  }
  node(type, from, props) { return { type, from, to: this.tokens[Math.max(0, this.i - 1)].to, line: this.lineOf(from), ...props }; }

  block() {
    const body = [];
    while (true) {
      const t = this.tok;
      if (t.t === 'eof' || (t.t === 'kw' && BLOCK_END.has(t.v))) break;
      if (this.accept('op', ';')) continue;
      const st = this.statement();
      body.push(st);
      if (st.type === 'Return') { this.accept('op', ';'); break; }
    }
    return body;
  }

  /** Schließt if/while/for/do – mit end (ohne Klammer) */
  closeBlock(kind, open) {
    const t = this.tok;
    if (t.t === 'kw' && t.v === 'end') { this.next(); return; }
    if (t.t === 'kw' && t.v === 'end)') {
      if (LOOPS.has(kind)) {
        this.warnings.push({ from: t.from + 3, to: t.to, message: `Schleifen enden mit end – das ) ist nur für Funktionen da.`, code: 'loop-paren' });
        this.next();
        return;
      }
      this.fail(`${kind} aus Zeile ${this.lineOf(open.from)} wird mit end geschlossen – ohne Klammer. end) ist nur für Funktionen.`, t, 'if-paren');
    }
    if (t.t === 'eof') this.fail(`${kind} aus Zeile ${this.lineOf(open.from)} wurde nicht mit end geschlossen.`, open, 'missing-end');
    this.unexpected(`end (für ${kind} aus Zeile ${this.lineOf(open.from)})`);
  }

  statement() {
    const t = this.tok;
    const from = t.from;
    if (t.t === 'kw') {
      switch (t.v) {
        case 'local': case 'let': case 'const': {
          this.next();
          if (this.isKw('function')) {
            const fnTok = this.next();
            if (t.v !== 'local') this.fail(`„${t.v} function“ gibt es nicht. Schreibe „function name()“ (überall aufrufbar) oder „local function name()“ (nur in dieser Datei).`, t);
            const nm = this.name('den Funktionsnamen');
            const fn = this.funcBody(nm.v, fnTok);
            return this.node('FunctionDecl', from, { name: nm.v, nameFrom: nm.from, path: [nm.v], local: true, func: fn });
          }
          const names = [];
          do { const nm = this.name('einen Variablennamen'); names.push({ name: nm.v, from: nm.from, to: nm.to }); } while (this.accept('op', ','));
          let values = [];
          if (this.accept('op', '=')) values = this.exprList();
          else if (t.v === 'const') this.fail(`const braucht sofort einen Wert, z. B. const ${names[0].name} = 10`, this.tok);
          return this.node('Decl', from, { kind: t.v, names, values });
        }
        case 'function': {
          this.next();
          const first = this.name('den Funktionsnamen');
          const path = [first.v];
          let method = false;
          while (this.isOp('.') || this.isOp(':')) {
            const sep = this.next().v;
            path.push(this.name().v);
            if (sep === ':') { method = true; break; }
          }
          const fn = this.funcBody(path.join('.'), t, method);
          return this.node('FunctionDecl', from, { name: path.join('.'), nameFrom: first.from, path, local: false, method, func: fn });
        }
        case 'if': return this.ifStatement();
        case 'while': {
          this.next();
          const cond = this.expr();
          this.expectKw('do', '„do“ nach der while-Bedingung');
          const body = this.block();
          this.closeBlock('while', t);
          return this.node('While', from, { cond, body });
        }
        case 'repeat': {
          this.next();
          const body = this.block();
          if (this.tok.t === 'eof') this.fail(`repeat aus Zeile ${this.lineOf(from)} braucht ein „until bedingung“.`, t, 'missing-end');
          this.expectKw('until', '„until“');
          const cond = this.expr();
          return this.node('Repeat', from, { body, cond });
        }
        case 'for': {
          this.next();
          const first = this.name('eine Zählvariable');
          if (this.accept('op', '=')) {
            const start = this.expr();
            this.expectOp(',', '„,“ – so: for i = start, ziel, schritt do');
            const stop = this.expr();
            const step = this.accept('op', ',') ? this.expr() : null;
            this.expectKw('do', '„do“');
            const body = this.block();
            this.closeBlock('for', t);
            return this.node('NumFor', from, { var: first.v, varFrom: first.from, start, stop, step, body });
          }
          const names = [first.v];
          while (this.accept('op', ',')) names.push(this.name().v);
          this.expectKw('in', '„in“ oder „=“');
          const iter = this.exprList();
          this.expectKw('do', '„do“');
          const body = this.block();
          this.closeBlock('for', t);
          return this.node('GenFor', from, { names, iter, body });
        }
        case 'do': {
          this.next();
          const body = this.block();
          this.closeBlock('do', t);
          return this.node('Do', from, { body });
        }
        case 'return': {
          this.next();
          const values = (this.tok.t === 'eof' || (this.tok.t === 'kw' && BLOCK_END.has(this.tok.v)) || this.isOp(';')) ? [] : this.exprList();
          return this.node('Return', from, { values });
        }
        case 'break': this.next(); return this.node('Break', from);
        case 'continue': this.next(); return this.node('Continue', from);
        case 'import': {
          this.next();
          const libs = [];
          do { const nm = this.name('den Namen der Bibliothek, z. B. import Html'); libs.push({ name: nm.v, from: nm.from, to: nm.to }); } while (this.accept('op', ','));
          return this.node('Import', from, { libs });
        }
        case 'else': case 'elseif': this.fail(`${t.v} ohne passendes if.`);
        default: break;
      }
    }
    // Ausdruck: Zuweisung oder Aufruf
    const target = this.suffixed();
    if (this.isOp('=') || this.isOp(',')) {
      const targets = [target];
      while (this.accept('op', ',')) targets.push(this.suffixed());
      for (const tg of targets) if (tg.type !== 'Name' && tg.type !== 'Index') this.fail('Hier kann nichts zugewiesen werden.', { from: tg.from, to: tg.to });
      this.expectOp('=');
      const values = this.exprList();
      return this.node('Assign', from, { targets, values });
    }
    if (this.tok.t === 'op' && COMPOUND.has(this.tok.v)) {
      const op = this.next().v.slice(0, -1);
      if (target.type !== 'Name' && target.type !== 'Index') this.fail('Hier kann nichts zugewiesen werden.', { from: target.from, to: target.to });
      const value = this.expr();
      return this.node('CompoundAssign', from, { target, op, value });
    }
    if (target.type !== 'Call' && target.type !== 'MethodCall') {
      this.fail('Dieser Ausdruck steht allein – meintest du eine Zuweisung (x = …) oder einen Aufruf (f())?', { from: target.from, to: target.to });
    }
    return this.node('CallStat', from, { call: target });
  }

  ifStatement() {
    const open = this.next();
    const from = open.from;
    const clauses = [];
    const cond = this.expr();
    this.expectKw('then', '„then“ nach der if-Bedingung');
    clauses.push({ cond, body: this.block() });
    let orelse = null;
    while (true) {
      if (this.isKw('elseif')) {
        this.next();
        const c = this.expr();
        this.expectKw('then', '„then“');
        clauses.push({ cond: c, body: this.block() });
        continue;
      }
      if (this.isKw('else')) { this.next(); orelse = this.block(); }
      break;
    }
    this.closeBlock('if', open);
    return this.node('If', from, { clauses, orelse });
  }

  /** Parameter + Körper; Funktionen müssen mit end) geschlossen werden. */
  funcBody(name, open, method = false) {
    const from = open.from;
    this.expectOp('(', '„(“ nach dem Funktionsnamen');
    const params = [];
    let vararg = false;
    if (!this.isOp(')')) {
      do {
        if (this.accept('op', '...')) { vararg = true; break; }
        const nm = this.name('einen Parameternamen');
        params.push(nm.v);
      } while (this.accept('op', ','));
    }
    this.expectOp(')', '„)“ nach den Parametern');
    const body = this.block();
    const t = this.tok;
    const label = name ? `Funktion „${name}“` : 'Funktion';
    if (t.t === 'kw' && t.v === 'end)') { this.next(); }
    else if (t.t === 'kw' && t.v === 'end') this.fail(`${label} (Zeile ${this.lineOf(from)}) muss mit end) geschlossen werden – die Klammer fehlt.`, t, 'func-paren');
    else if (t.t === 'eof') this.fail(`${label} aus Zeile ${this.lineOf(from)} wurde nicht mit end) geschlossen.`, open, 'missing-end');
    else this.unexpected(`end) für die ${label}`);
    return this.node('Function', from, { name, params, vararg, body, method });
  }

  exprList() {
    const list = [this.expr()];
    while (this.accept('op', ',')) list.push(this.expr());
    return list;
  }

  expr(limit = 0) {
    const t = this.tok;
    let left;
    if ((t.t === 'kw' && t.v === 'not') || (t.t === 'op' && (t.v === '-' || t.v === '#'))) {
      this.next();
      const arg = this.expr(UNARY_PRIO);
      left = this.node('Unary', t.from, { op: t.v, arg });
    } else left = this.simple();
    while (true) {
      const op = this.tok;
      const key = op.t === 'op' || (op.t === 'kw' && (op.v === 'and' || op.v === 'or')) ? op.v : null;
      const prio = key && BINARY[key];
      if (!prio || prio[0] <= limit) break;
      this.next();
      const right = this.expr(prio[1]);
      left = { type: 'Binary', op: key === '!=' ? '~=' : key, left, right, from: left.from, to: right.to, line: left.line };
    }
    return left;
  }

  simple() {
    const t = this.tok;
    switch (t.t) {
      case 'num': this.next(); return this.node('Number', t.from, { value: t.v });
      case 'str': this.next(); return this.stringNode(t);
      case 'kw':
        if (t.v === 'nil') { this.next(); return this.node('Nil', t.from); }
        if (t.v === 'true' || t.v === 'false') { this.next(); return this.node('Bool', t.from, { value: t.v === 'true' }); }
        if (t.v === 'function') { this.next(); return this.funcBody('', t); }
        break;
      case 'op':
        if (t.v === '...') { this.next(); return this.node('Vararg', t.from); }
        if (t.v === '{') return this.table();
        break;
      default: break;
    }
    return this.suffixed();
  }

  stringNode(t) {
    if (!t.parts) return { type: 'String', value: t.v, from: t.from, to: t.to, line: this.lineOf(t.from) };
    const parts = t.parts.map((part) => {
      if (typeof part === 'string') return part;
      const sub = tokenize(part.code).tokens.map((x) => ({ ...x, from: x.from + part.from, to: x.to + part.from }));
      const p = new Parser(this.src, sub);
      p.lineStarts = this.lineStarts;
      if (sub.length === 1) p.fail('Leerer Platzhalter {}.', { from: part.from - 1, to: part.from + 1 });
      const e = p.expr();
      if (p.tok.t !== 'eof') p.unexpected('„}“');
      return e;
    });
    return { type: 'Template', parts, from: t.from, to: t.to, line: this.lineOf(t.from) };
  }

  table() {
    const open = this.next();
    const fields = [];
    while (!this.isOp('}')) {
      if (this.tok.t === 'eof') this.fail(`Tabelle aus Zeile ${this.lineOf(open.from)} wurde nicht mit } geschlossen.`, open, 'missing-end');
      if (this.isOp('[')) {
        this.next();
        const key = this.expr();
        this.expectOp(']');
        this.expectOp('=');
        fields.push({ key, value: this.expr() });
      } else if (this.tok.t === 'name' && this.peek().t === 'op' && this.peek().v === '=') {
        const nm = this.next();
        this.next();
        fields.push({ key: { type: 'String', value: nm.v, from: nm.from, to: nm.to }, value: this.expr() });
      } else fields.push({ key: null, value: this.expr() });
      if (!this.accept('op', ',') && !this.accept('op', ';')) break;
    }
    this.expectOp('}', '„}“ oder „,“');
    return this.node('Table', open.from, { fields });
  }

  primary() {
    const t = this.tok;
    if (t.t === 'name') { this.next(); return this.node('Name', t.from, { name: t.v }); }
    if (t.t === 'op' && t.v === '(') {
      this.next();
      const e = this.expr();
      this.expectOp(')', '„)“');
      return this.node('Paren', t.from, { expr: e });
    }
    if (t.t === 'kw' && (t.v === 'end' || t.v === 'end)')) this.unexpected();
    this.unexpected('einen Ausdruck');
  }

  suffixed() {
    let e = this.primary();
    while (true) {
      const t = this.tok;
      if (t.t === 'op' && t.v === '.') {
        this.next();
        const nm = this.name('einen Namen nach dem Punkt');
        e = { type: 'Index', obj: e, key: { type: 'String', value: nm.v, from: nm.from, to: nm.to }, dot: true, from: e.from, to: nm.to, line: e.line };
      } else if (t.t === 'op' && t.v === '[') {
        this.next();
        const key = this.expr();
        this.expectOp(']');
        e = { type: 'Index', obj: e, key, from: e.from, to: this.tokens[this.i - 1].to, line: e.line };
      } else if (t.t === 'op' && t.v === ':') {
        this.next();
        const nm = this.name('einen Methodennamen nach dem Doppelpunkt');
        const args = this.callArgs();
        e = { type: 'MethodCall', obj: e, method: nm.v, methodFrom: nm.from, args, from: e.from, to: this.tokens[this.i - 1].to, line: e.line };
      } else if ((t.t === 'op' && (t.v === '(' || t.v === '{')) || t.t === 'str') {
        const args = this.callArgs();
        e = { type: 'Call', fn: e, args, from: e.from, to: this.tokens[this.i - 1].to, line: e.line };
      } else return e;
    }
  }

  /** Argumente. Besonderheit: endet das letzte Argument mit function … end), schließt dieses ) auch den Aufruf. */
  callArgs() {
    const t = this.tok;
    if (t.t === 'str') { this.next(); return [this.stringNode(t)]; }
    if (t.t === 'op' && t.v === '{') return [this.table()];
    this.expectOp('(', '„(“');
    const args = [];
    if (this.accept('op', ')')) return args;
    while (true) {
      const e = this.expr();
      args.push(e);
      if (this.accept('op', ',')) continue;
      if (e.type === 'Function') return args; // end) hat den Aufruf schon geschlossen
      if (this.isOp(')')) { this.next(); return args; }
      this.unexpected('„)“ oder „,“');
    }
  }
}

/** Zeilennummer für eine Position */
export function lineAt(src, pos) {
  let line = 1;
  for (let i = 0; i < pos && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}
