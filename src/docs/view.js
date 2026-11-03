// Doku-Seite (wird als Tab im Editor geöffnet – funktioniert offline) + Liste für die Docs-Seitenleiste.
import { highlightCode, classHighlighter } from '../../vendor/core.js';
import { h, frag } from '../core/util.js';
import { icon } from '../core/icons.js';
import { app } from '../core/store.js';
import { KIND_LABEL, related, SETS, searchDocs } from './registry.js';
import { kindIcon } from '../editor/completion.js';

async function parserFor(lang) {
  if (lang === 'js' || lang === 'ts') { const { js } = await import('../../vendor/lang-web.js'); return js.javascriptLanguage.parser.configure({ dialect: lang === 'ts' ? 'ts' : '' }); }
  if (lang === 'html') { const { html } = await import('../../vendor/lang-web.js'); return html.htmlLanguage.parser; }
  if (lang === 'css') { const { css } = await import('../../vendor/lang-web.js'); return css.cssLanguage.parser; }
  if (lang === 'py') { const { python } = await import('../../vendor/lang-more.js'); return python.pythonLanguage.parser; }
  if (lang === 'java') { const { java } = await import('../../vendor/lang-more.js'); return java.javaLanguage.parser; }
  return null;
}

export function codeBlock(code, lang) {
  const pre = h('pre', { class: 'doc-code' }, h('code', {}, code));
  parserFor(lang).then((parser) => {
    if (!parser) return;
    const out = h('code', {});
    highlightCode(code, parser.parse(code), classHighlighter,
      (text, classes) => out.append(classes ? h('span', { class: classes }, text) : text),
      () => out.append('\n'));
    pre.replaceChildren(out);
  }).catch(() => {});
  return pre;
}

const cleanSnippet = (s) => s.replace(/\$\{([^}]*)\}/g, '$1');

export function renderDocPage(e) {
  const set = SETS[e.lang];
  const rel = related(e);
  return h('article', { class: 'doc-page' },
    h('nav', { class: 'doc-crumbs' },
      h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); app.emit('show-docs', { lang: e.lang }); } }, 'Dokumentation'),
      h('span', {}, '/'), h('span', {}, set.name),
      e.owner ? [h('span', {}, '/'), h('span', {}, e.owner)] : null),
    h('header', { class: 'doc-head' },
      kindIcon(e.kind),
      h('div', {},
        h('h1', {}, e.owner && e.kind !== 'class' && e.kind !== 'interface' && e.kind !== 'exception' ? h('span', { class: 'doc-owner' }, e.owner.replace('.prototype', '') + '.') : null, e.label),
        h('div', { class: 'doc-meta' },
          h('span', { class: 'pill' }, KIND_LABEL[e.kind] || e.kind),
          h('span', { class: 'pill lang' }, set.name),
          (e.kind === 'class' || e.kind === 'interface' || e.kind === 'exception') && e.owner ? h('span', { class: 'pill' }, e.owner) : null))),
    h('p', { class: 'doc-desc' }, e.desc),
    h('h2', {}, e.kind === 'snippet' ? 'Einfügen' : 'Syntax'),
    codeBlock(e.kind === 'snippet' ? cleanSnippet(e.sig) : e.sig, e.lang),
    h('div', { class: 'doc-actions' },
      h('a', { class: 'btn primary', href: e.url, target: '_blank', rel: 'noopener' }, frag(icon.external), `Vollständige Referenz (${e.refName})`),
      h('button', { class: 'btn', onclick: () => app.emit('insert-text', e.kind === 'snippet' ? cleanSnippet(e.sig) : e.label) }, frag(icon.plus), 'In Editor einfügen')),
    rel.length ? [h('h2', {}, 'Verwandt'), h('div', { class: 'doc-related' }, rel.map((r) => h('button', { class: 'doc-rel', onclick: () => app.emit('open-doc', r.id) }, kindIcon(r.kind), h('span', { class: 'name' }, r.label), h('span', { class: 'desc' }, r.desc))))] : null,
    h('p', { class: 'doc-note' }, 'Kurzreferenz von Luna. Die ausführliche Dokumentation findest du über den Link oben.'),
  );
}

/** Seitenleisten-Panel „Docs“ */
export function renderDocsPanel(container, { lang = '' } = {}) {
  let current = lang;
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Dokumentation durchsuchen …', autocomplete: 'off' });
  const chips = h('div', { class: 'chips' });
  const list = h('div', { class: 'docs-list' });
  const renderChips = () => chips.replaceChildren(
    ...[['', 'Alle'], ...Object.values(SETS).map((s) => [s.id, s.name])].map(([id, name]) =>
      h('button', { class: 'chip' + (current === id ? ' on' : ''), onclick: () => { current = id; renderChips(); renderList(); } }, name)));
  const renderList = () => {
    const results = searchDocs(input.value, current);
    list.replaceChildren(...results.map((e) => h('button', { class: 'docs-item', onclick: () => app.emit('open-doc', e.id), title: e.desc },
      kindIcon(e.kind),
      h('span', { class: 'name' }, e.owner && !e.owner.includes('.') && e.lang !== 'java' ? h('span', { class: 'owner' }, e.owner + '.') : null, e.label),
      h('span', { class: 'lang' }, SETS[e.lang].name))));
    if (!results.length) list.append(h('p', { class: 'muted pad' }, 'Nichts gefunden.'));
  };
  input.addEventListener('input', renderList);
  container.replaceChildren(h('div', { class: 'docs-panel' }, h('div', { class: 'docs-search' }, frag(icon.search), input), chips, list));
  renderChips(); renderList();
  return { focus: () => input.focus(), setLang: (l) => { current = l; renderChips(); renderList(); } };
}
