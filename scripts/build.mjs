// Build: bündelt CodeMirror/Yjs nach vendor/, kopiert Schriften und schreibt die Offline-Liste in sw.js.
// Die App selbst (src/) läuft ohne Build direkt als ES-Module.
import { build } from 'esbuild';
import { readdirSync, rmSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const vendor = join(root, 'vendor');

// 1) Vendor-Bundle
for (const f of existsSync(vendor) ? readdirSync(vendor) : []) if (f.endsWith('.js')) rmSync(join(vendor, f));
await build({
  entryPoints: {
    core: join(root, 'scripts/vendor/core.js'),
    'lang-web': join(root, 'scripts/vendor/lang-web.js'),
    'lang-more': join(root, 'scripts/vendor/lang-more.js'),
    'lang-legacy': join(root, 'scripts/vendor/lang-legacy.js'),
  },
  bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2020',
  outdir: vendor, chunkNames: 'chunk-[hash]', legalComments: 'none', logLevel: 'warning',
});
console.log('✓ vendor/ gebündelt');

// 2) Schriften (Inter für die Oberfläche, JetBrains Mono für Code)
const fonts = join(vendor, 'fonts');
mkdirSync(fonts, { recursive: true });
const faces = [];
for (const w of [400, 500, 600, 700]) {
  const f = `inter-latin-${w}-normal.woff2`;
  copyFileSync(join(root, 'node_modules/@fontsource/inter/files', f), join(fonts, f));
  faces.push(`@font-face{font-family:Inter;font-style:normal;font-weight:${w};font-display:swap;src:url(${f}) format('woff2')}`);
}
for (const w of [400, 500, 700]) for (const s of ['normal', 'italic']) {
  const f = `jetbrains-mono-latin-${w}-${s}.woff2`;
  copyFileSync(join(root, 'node_modules/@fontsource/jetbrains-mono/files', f), join(fonts, f));
  faces.push(`@font-face{font-family:'JetBrains Mono';font-style:${s};font-weight:${w};font-display:swap;src:url(${f}) format('woff2')}`);
}
writeFileSync(join(fonts, 'fonts.css'), faces.join('\n') + '\n');
console.log('✓ Schriften kopiert');

// 3) Offline-Liste für den Service Worker
const files = ['./', 'index.html', 'docs.html', 'manifest.webmanifest', 'luna.config.json'];
const walk = (dir) => {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel);
    else if (!name.startsWith('.') && name !== 'logo-original.png') files.push(relative(root, join(root, rel)).split('\\').join('/'));
  }
};
['src', 'styles', 'vendor', 'icons'].forEach(walk);
const hash = createHash('sha256');
for (const f of files) if (f !== './') hash.update(f).update(readFileSync(join(root, f)));
const version = hash.digest('hex').slice(0, 12);
const sw = readFileSync(join(root, 'sw.js'), 'utf8').replace(
  /\/\/ <precache>[\s\S]*?\/\/ <\/precache>/,
  `// <precache>\nconst VERSION = '${version}';\nconst PRECACHE = ${JSON.stringify(files, null, 0).replace(/","/g, '",\n  "')};\n// </precache>`,
);
writeFileSync(join(root, 'sw.js'), sw);
console.log(`✓ sw.js aktualisiert (${files.length} Dateien, Version ${version})`);
