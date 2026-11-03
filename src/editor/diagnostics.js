// Prüfungen (Syntaxfehler aus dem Parser + JSON) und das rote Zähler-Badge am Zeilenende (Bild 4).
import {
  linter, forEachDiagnostic, ensureSyntaxTree, ViewPlugin, Decoration, WidgetType, syntaxTree,
} from '../../vendor/core.js';
import { langInfo } from '../core/langs.js';
import { fileLangFacet } from './completion.js';
import { analyze, lunaSymbolPath } from '../luna/analysis.js';
import { otherScripts } from '../luna/project.js';

function syntaxDiagnostics(view) {
  const lang = view.state.facet(fileLangFacet);
  const out = [];
  const doc = view.state.doc;
  if (lang === 'luna') {
    try { return analyze(doc.toString(), { others: otherScripts(view.state) }); }
    catch (e) { console.warn('Luna-Prüfung fehlgeschlagen', e); return []; }
  }
  if (lang === 'text') return out;
  if (lang === 'json') {
    const text = doc.toString();
    if (text.trim()) {
      try { JSON.parse(text); } catch (e) {
        const m = /position (\d+)/.exec(e.message) || /line (\d+) column (\d+)/.exec(e.message);
        let pos = 0;
        if (m && m.length === 2) pos = Math.min(+m[1], doc.length);
        else if (m) { const line = doc.line(Math.min(+m[1], doc.lines)); pos = Math.min(line.from + +m[2] - 1, line.to); }
        out.push({ from: pos, to: Math.min(pos + 1, doc.length), severity: 'error', message: 'JSON: ' + e.message.replace(/^JSON\.parse: /, '') });
      }
    }
    return out;
  }
  if (!['javascript', 'jsx', 'typescript', 'tsx', 'python', 'java', 'css', 'scss', 'html', 'rust', 'cpp', 'c', 'php', 'yaml', 'xml'].includes(lang)) return out;
  const tree = ensureSyntaxTree(view.state, doc.length, 300);
  if (!tree) return out;
  let count = 0;
  tree.iterate({
    enter(node) {
      if (count > 60) return false;
      if (node.type.isError) {
        const from = node.from, to = Math.max(node.to, Math.min(node.from + 1, doc.length));
        if (out.length && out[out.length - 1].from === from) return;
        out.push({ from, to, severity: 'error', message: 'Syntaxfehler – hier erwartet der Parser etwas anderes.', source: langInfo(lang).name });
        count++;
      } else if (node.name === 'MismatchedCloseTag') {
        out.push({ from: node.from, to: node.to, severity: 'warning', message: 'Schließendes Tag passt nicht zum geöffneten Tag.' });
      }
    },
  });
  return out;
}

export const lunaLinter = linter(syntaxDiagnostics, { delay: 500 });

// ---------- Zähler-Badge am Zeilenende ----------
class BadgeWidget extends WidgetType {
  constructor(count, severity) { super(); this.count = count; this.severity = severity; }
  eq(o) { return o.count === this.count && o.severity === this.severity; }
  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-diag-badge ${this.severity}${this.count > 1 ? ' stacked' : ''}`;
    el.textContent = this.count;
    el.title = `${this.count} ${this.count === 1 ? 'Problem' : 'Probleme'} in dieser Zeile`;
    return el;
  }
  ignoreEvent() { return false; }
}

export const diagnosticBadges = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view.state); }
  update(u) { if (u.docChanged || u.transactions.some((t) => t.effects.length)) this.decorations = this.build(u.state); }
  build(state) {
    const lines = new Map();
    forEachDiagnostic(state, (d, from) => {
      const line = state.doc.lineAt(Math.min(from, state.doc.length));
      const cur = lines.get(line.number) || { count: 0, severity: 'warning', to: line.to };
      cur.count++;
      if (d.severity === 'error') cur.severity = 'error';
      lines.set(line.number, cur);
    });
    const decos = [...lines.entries()].sort((a, b) => a[0] - b[0])
      .map(([, v]) => Decoration.widget({ widget: new BadgeWidget(v.count, v.severity), side: 1 }).range(v.to));
    return Decoration.set(decos);
  }
}, { decorations: (v) => v.decorations });

// ---------- Symbol unter dem Cursor (für den Breadcrumb in der Statuszeile) ----------
const CONTAINER = /^(FunctionDeclaration|ClassDeclaration|MethodDeclaration|VariableDeclaration|FunctionDefinition|ClassDefinition|InterfaceDeclaration|TypeAliasDeclaration|EnumDeclaration|PropertyDeclaration|Property|ConstructorDeclaration|RecordDeclaration|FieldDeclaration|LocalVariableDeclaration|ArrowFunction|RuleSet)$/;
const NAME = /^(VariableDefinition|PropertyDefinition|Definition|VariableName|TypeDefinition|PropertyName|Identifier|TagSelector|ClassSelector|IdSelector)$/;

export function symbolPath(state, pos) {
  if (state.facet(fileLangFacet) === 'luna') return lunaSymbolPath(state.doc.toString(), pos);
  const names = [];
  let node = syntaxTree(state).resolveInner(pos, -1);
  for (let n = node; n; n = n.parent) {
    if (!CONTAINER.test(n.name)) continue;
    if (n.name === 'RuleSet') { names.unshift(state.sliceDoc(n.from, Math.min(n.to, n.from + 40)).split('{')[0].trim()); continue; }
    let c = n.firstChild;
    while (c && !NAME.test(c.name)) {
      if (c.name === 'VariableDeclarator') { c = c.firstChild; continue; }
      c = c.nextSibling;
    }
    if (c) {
      const text = state.sliceDoc(c.from, c.to);
      if (text && text.length < 50 && names[0] !== text) names.unshift(text);
    }
  }
  return names;
}

export { diagnosticCount } from '../../vendor/core.js';
