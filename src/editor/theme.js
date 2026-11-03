// Editor-Theme (dunkel, an Bild 2–4 angelehnt) + Einrückungs-Hilfslinien.
import { EditorView, HighlightStyle, syntaxHighlighting, tags as t, ViewPlugin, Decoration, RangeSetBuilder } from '../../vendor/core.js';

const C = {
  text: '#d1d3d8',
  keyword: '#82d2ce',
  fn: '#ebc88d',
  fnCall: '#5db0f5',
  prop: '#af9cff',
  string: '#e982e1',
  number: '#ebc88d',
  type: '#82d2ce',
  className: '#efb081',
  annotation: '#f5be50',
  tag: '#fad075',
  attr: '#a9a0f9',
  comment: '#6b7280',
  operator: '#9aa3ad',
  constant: '#f08d9a',
  regexp: '#7ee0a5',
  invalid: '#ff6b81',
};

export const lunaHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self], color: C.keyword },
  { tag: [t.function(t.definition(t.variableName)), t.function(t.definition(t.propertyName))], color: C.fn },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: C.fnCall },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: C.prop },
  { tag: [t.string, t.special(t.string), t.character, t.docString], color: C.string },
  { tag: [t.number, t.integer, t.float], color: C.number },
  { tag: [t.bool, t.null, t.atom, t.constant(t.variableName), t.standard(t.variableName)], color: C.constant },
  { tag: [t.typeName, t.namespace], color: C.type },
  { tag: [t.className, t.definition(t.className)], color: C.className },
  { tag: [t.annotation, t.meta, t.processingInstruction], color: C.annotation },
  { tag: [t.tagName, t.angleBracket], color: C.tag },
  { tag: [t.attributeName], color: C.attr },
  { tag: [t.attributeValue], color: C.string },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: C.comment, fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.derefOperator], color: C.operator },
  { tag: [t.regexp, t.escape], color: C.regexp },
  { tag: [t.variableName, t.definition(t.variableName), t.labelName], color: C.text },
  { tag: t.heading, color: C.fn, fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: C.fnCall, textDecoration: 'underline' },
  { tag: t.url, color: C.fnCall },
  { tag: [t.inserted], color: '#7ee0a5' },
  { tag: [t.deleted], color: '#ff8a8a' },
  { tag: t.invalid, color: C.invalid },
]);

export const lunaTheme = EditorView.theme({
  '&': { color: C.text, backgroundColor: 'transparent', height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.65', overscrollBehavior: 'contain' },
  '.cm-content': { caretColor: '#e8e9ee', padding: '10px 0 40vh' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#e8e9ee', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: '#5f646d', border: 'none', paddingLeft: '8px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px', minWidth: '34px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#c9ccd3' },
  '.cm-activeLine': { backgroundColor: 'var(--cur-line)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#2b4a78 !important' },
  '.cm-selectionMatch': { backgroundColor: '#2a3a52' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: '#2c3a4f', outline: '1px solid #45608a', color: 'inherit' },
  '.cm-foldGutter .cm-gutterElement': { color: '#4f545c', padding: '0 4px' },
  '.cm-foldPlaceholder': { background: '#23262d', border: '1px solid #343842', color: '#9aa0aa', borderRadius: '4px', padding: '0 6px' },
  '.cm-searchMatch': { backgroundColor: '#5a4a1d', outline: '1px solid #8a7330' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#7a5f16' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-tooltip': { backgroundColor: '#252629', border: '1px solid #3a3c42', borderRadius: '10px', color: '#e0e1e4', boxShadow: '0 12px 32px rgba(0,0,0,.45)' },
  '.cm-tooltip-hover': { padding: '6px 10px', maxWidth: '420px' },
  '.cm-diagnostic': { padding: '4px 8px', borderLeftWidth: '3px' },
  '.cm-diagnostic-error': { borderLeftColor: '#e5484d' },
  '.cm-diagnostic-warning': { borderLeftColor: '#ffb224' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #e5484d 1px', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy #ffb224 1px', textUnderlineOffset: '3px' },
  '.cm-placeholder': { color: '#5f646d' },
}, { dark: true });

// ---------- Einrückungs-Hilfslinien (wie in Bild 4) ----------
const guideCache = new Map();
function guideDeco(levels, tab) {
  const key = levels + ':' + tab;
  if (!guideCache.has(key)) {
    guideCache.set(key, Decoration.line({ attributes: { class: 'cm-guides', style: `--guide-w:${levels * tab}ch;--guide-step:${tab}ch` } }));
  }
  return guideCache.get(key);
}

export const indentGuides = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) { if (u.docChanged || u.viewportChanged || u.geometryChanged) this.decorations = this.build(u.view); }
  build(view) {
    const builder = new RangeSetBuilder();
    const tab = view.state.tabSize;
    const doc = view.state.doc;
    const indentOf = (text) => {
      let col = 0;
      for (const ch of text) { if (ch === ' ') col++; else if (ch === '\t') col += tab - (col % tab); else break; }
      return col;
    };
    for (const { from, to } of view.visibleRanges) {
      let line = doc.lineAt(from);
      while (true) {
        let text = line.text;
        let ind;
        if (!text.trim()) {
          // Leerzeilen: Einrückung der nächsten nicht-leeren Zeile übernehmen
          let n = line.number + 1; ind = 0;
          while (n <= doc.lines && n < line.number + 50) { const t2 = doc.line(n).text; if (t2.trim()) { ind = indentOf(t2); break; } n++; }
        } else ind = indentOf(text);
        const levels = Math.floor(ind / tab);
        if (levels > 0) builder.add(line.from, line.from, guideDeco(levels, tab));
        if (line.to >= to || line.number >= doc.lines) break;
        line = doc.line(line.number + 1);
      }
    }
    return builder.finish();
  }
}, { decorations: (v) => v.decorations });

export const editorHighlighting = syntaxHighlighting(lunaHighlight);

// Verhindert, dass der Browser beim Antippen (Handy/Tablet) den Code unter die feststehenden Zeilennummern scrollt:
// scroll-padding in Breite der Gutter-Spalte.
export const gutterScrollPadding = ViewPlugin.fromClass(class {
  constructor(view) { this.view = view; this.w = -1; this.measure(); }
  update(u) { if (u.geometryChanged || u.viewportChanged || u.docChanged) this.measure(); }
  measure() {
    this.view.requestMeasure({
      read: (view) => view.dom.querySelector('.cm-gutters')?.offsetWidth || 0,
      write: (w, view) => { if (w !== this.w) { this.w = w; view.scrollDOM.style.scrollPaddingLeft = w + 'px'; } },
    });
  }
});
