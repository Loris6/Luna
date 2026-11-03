// Service Worker: macht Luna offline nutzbar (PWA). Die Liste unten wird von `npm run build` erzeugt.
// <precache>
const VERSION = '2a4d9e55cad1';
const PRECACHE = ["./",
  "index.html",
  "manifest.webmanifest",
  "src/collab/session.js",
  "src/config.js",
  "src/core/db.js",
  "src/core/icons.js",
  "src/core/keyboard.js",
  "src/core/langs.js",
  "src/core/store.js",
  "src/core/util.js",
  "src/docs/data/css.js",
  "src/docs/data/html.js",
  "src/docs/data/java.js",
  "src/docs/data/js.js",
  "src/docs/data/luna.js",
  "src/docs/data/py.js",
  "src/docs/data/ts.js",
  "src/docs/registry.js",
  "src/docs/view.js",
  "src/editor/completion.js",
  "src/editor/diagnostics.js",
  "src/editor/editor.js",
  "src/editor/theme.js",
  "src/luna/analysis.js",
  "src/luna/language.js",
  "src/luna/parser.js",
  "src/luna/project.js",
  "src/luna/runtime.js",
  "src/main.js",
  "src/projects/folder.js",
  "src/projects/github.js",
  "src/projects/gitignore.js",
  "src/projects/projects.js",
  "src/projects/templates.js",
  "src/ui/actions.js",
  "src/ui/dialog.js",
  "src/ui/menu.js",
  "src/ui/panels.js",
  "src/ui/sidebar.js",
  "src/ui/topbar.js",
  "src/ui/welcome.js",
  "styles/app.css",
  "vendor/chunk-FEONQHQG.js",
  "vendor/chunk-M7AD2PUT.js",
  "vendor/chunk-XRE6V766.js",
  "vendor/core.js",
  "vendor/fonts/fonts.css",
  "vendor/fonts/inter-latin-400-normal.woff2",
  "vendor/fonts/inter-latin-500-normal.woff2",
  "vendor/fonts/inter-latin-600-normal.woff2",
  "vendor/fonts/inter-latin-700-normal.woff2",
  "vendor/fonts/jetbrains-mono-latin-400-italic.woff2",
  "vendor/fonts/jetbrains-mono-latin-400-normal.woff2",
  "vendor/fonts/jetbrains-mono-latin-500-italic.woff2",
  "vendor/fonts/jetbrains-mono-latin-500-normal.woff2",
  "vendor/fonts/jetbrains-mono-latin-700-italic.woff2",
  "vendor/fonts/jetbrains-mono-latin-700-normal.woff2",
  "vendor/lang-legacy.js",
  "vendor/lang-more.js",
  "vendor/lang-web.js",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon.svg",
  "icons/maskable-512.png",
  "icons/maskable.svg"];
// </precache>
const CACHE = 'luna-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Einzeln laden, damit eine fehlende Datei nicht die ganze Installation abbricht
    await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('luna-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // GitHub-API usw. nicht cachen
  if (url.pathname.endsWith('/collab')) return;

  // Navigation: erst Netz (frische Version), sonst Cache
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Dateien: Cache zuerst, im Hintergrund aktualisieren
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response('Offline', { status: 503 });
  })());
});
