// Welche Sprachen Luna gerade unterstützt (Einfärbung, Vorschläge, Prüfung, Doku, Ausführen).
// Erstmal nur die eigene Sprache Luna – weitere (z. B. 'js', 'ts', 'html', 'css', 'py', 'java') können hier
// später wieder eingeschaltet werden; ihre Daten liegen in src/docs/data/.
export const ENABLED_LANGUAGES = ['luna'];
export const isEnabled = (docsId) => ENABLED_LANGUAGES.includes(docsId);
