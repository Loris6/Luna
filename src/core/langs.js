// Sprachen: Dateiname → Anzeige-Name, Docs-Sprache und CodeMirror-Erweiterung (lazy geladen).
import { basename, extname } from './util.js';

const web = () => import('../../vendor/lang-web.js');
const more = () => import('../../vendor/lang-more.js');
const legacy = () => import('../../vendor/lang-legacy.js');
const core = () => import('../../vendor/core.js');

const stream = (name) => async () => {
  const [{ StreamLanguage }, L] = await Promise.all([core(), legacy()]);
  return StreamLanguage.define(L[name]);
};

// docs: Schlüssel der Vorschlags-/Doku-Datenbank (siehe src/docs)
export const LANGS = {
  javascript: { name: 'JavaScript', docs: 'js', load: async () => { const { js } = await web(); return withTag(js.javascript(), js.javascriptLanguage, 'js'); } },
  jsx: { name: 'JavaScript JSX', docs: 'js', load: async () => { const { js } = await web(); return withTag(js.javascript({ jsx: true }), js.javascriptLanguage, 'js'); } },
  typescript: { name: 'TypeScript', docs: 'ts', load: async () => { const { js } = await web(); return withTag(js.javascript({ typescript: true }), js.javascriptLanguage, 'js'); } },
  tsx: { name: 'TypeScript JSX', docs: 'ts', load: async () => { const { js } = await web(); return withTag(js.javascript({ typescript: true, jsx: true }), js.javascriptLanguage, 'js'); } },
  html: { name: 'HTML', docs: 'html', load: async () => { const { html, js, css } = await web(); return [withTag(html.html(), html.htmlLanguage, 'html'), tag(js.javascriptLanguage, 'js'), tag(css.cssLanguage, 'css')]; } },
  css: { name: 'CSS', docs: 'css', load: async () => { const { css } = await web(); return withTag(css.css(), css.cssLanguage, 'css'); } },
  scss: { name: 'SCSS', docs: 'css', load: async () => { const { css } = await web(); return withTag(css.css(), css.cssLanguage, 'css'); } },
  json: { name: 'JSON', docs: null, load: async () => { const { json } = await web(); return json.json(); } },
  markdown: { name: 'Markdown', docs: 'md', load: async () => { const { markdown } = await web(); return markdown.markdown(); } },
  xml: { name: 'XML', docs: null, load: async () => { const { xml } = await web(); return xml.xml(); } },
  svg: { name: 'SVG', docs: null, load: async () => { const { xml } = await web(); return xml.xml(); } },
  yaml: { name: 'YAML', docs: null, load: async () => { const { yaml } = await web(); return yaml.yaml(); } },
  python: { name: 'Python', docs: 'py', load: async () => { const { python } = await more(); return withTag(python.python(), python.pythonLanguage, 'py'); } },
  java: { name: 'Java', docs: 'java', load: async () => { const { java } = await more(); return withTag(java.java(), java.javaLanguage, 'java'); } },
  sql: { name: 'SQL', docs: null, load: async () => { const { sql } = await more(); return sql.sql(); } },
  rust: { name: 'Rust', docs: null, load: async () => { const { rust } = await more(); return rust.rust(); } },
  cpp: { name: 'C++', docs: null, load: async () => { const { cpp } = await more(); return cpp.cpp(); } },
  c: { name: 'C', docs: null, load: async () => { const { cpp } = await more(); return cpp.cpp(); } },
  php: { name: 'PHP', docs: null, load: async () => { const { php } = await more(); return php.php(); } },
  kotlin: { name: 'Kotlin', docs: null, load: stream('kotlin') },
  csharp: { name: 'C#', docs: null, load: stream('csharp') },
  dart: { name: 'Dart', docs: null, load: stream('dart') },
  shell: { name: 'Shell', docs: null, load: stream('shell') },
  powershell: { name: 'PowerShell', docs: null, load: stream('powerShell') },
  dockerfile: { name: 'Dockerfile', docs: null, load: stream('dockerFile') },
  lua: { name: 'Lua', docs: null, load: stream('lua') },
  toml: { name: 'TOML', docs: null, load: stream('toml') },
  go: { name: 'Go', docs: null, load: stream('go') },
  ruby: { name: 'Ruby', docs: null, load: stream('ruby') },
  swift: { name: 'Swift', docs: null, load: stream('swift') },
  diff: { name: 'Diff', docs: null, load: stream('diff') },
  properties: { name: 'Properties', docs: null, load: stream('properties') },
  nginx: { name: 'Nginx', docs: null, load: stream('nginx') },
  text: { name: 'Text', docs: null, load: async () => [] },
};

// Markiert eine Sprache, damit die Vorschläge auch in verschachtelten Sprachen (z. B. <script> in HTML) passen.
function tag(language, id) { return language.data.of({ lunaLang: id }); }
function withTag(ext, language, id) { return [ext, tag(language, id)]; }

const EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'css', json: 'json', jsonc: 'json', webmanifest: 'json', map: 'json',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown', xml: 'xml', svg: 'svg', plist: 'xml', yml: 'yaml', yaml: 'yaml',
  py: 'python', pyw: 'python', java: 'java', sql: 'sql', rs: 'rust', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp',
  php: 'php', kt: 'kotlin', kts: 'kotlin', cs: 'csharp', dart: 'dart', sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell',
  lua: 'lua', luau: 'lua', toml: 'toml', go: 'go', rb: 'ruby', swift: 'swift', diff: 'diff', patch: 'diff', properties: 'properties', ini: 'properties', conf: 'nginx',
  txt: 'text', log: 'text',
};

export function langIdFor(path) {
  const name = basename(path).toLowerCase();
  if (name === 'dockerfile' || name.endsWith('.dockerfile') || name.startsWith('dockerfile.')) return 'dockerfile';
  if (name === 'makefile') return 'shell';
  if (name.startsWith('.env') || name === '.gitignore' || name === '.gitattributes' || name === '.gitmodules' || name === '.editorconfig' || name === '.npmrc') return 'properties';
  return EXT[extname(path)] || 'text';
}

export const langInfo = (id) => LANGS[id] || LANGS.text;

const cache = new Map();
export function loadLanguage(id) {
  if (!cache.has(id)) cache.set(id, langInfo(id).load().catch((e) => { console.warn('Sprache nicht geladen', id, e); return []; }));
  return cache.get(id);
}
