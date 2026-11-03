# 🌙 Luna – Code-Editor im Browser

Luna ist eine Code-Editor-IDE als Webseite, die sich als **PWA** installieren lässt und **offline** funktioniert.
Sie läuft auf PC, Tablet und Handy – mit eigener Handy-Ansicht.

> **Luna** = allgemeine IDE (dieses Repo) · **Lunar** = dieselbe Idee, speziell für Roblox optimiert (eigenes Repo).

## Funktionen

| Bereich | Was Luna kann |
| --- | --- |
| **Oberfläche** | Titelleiste mit Workspace, Zurück/Vor, Verlauf · Seitenleiste mit *Repos / Docs / Suche* · Tabs, Datei-Kopfzeile, Statuszeile (Pfad / Symbol, `Ln 17, Col 42`, `UTF-8`, Sprache) · geteilte Ansicht (untereinander oder nebeneinander) |
| **Repos** | Mehrere Repositories im Workspace · „…“-Menü mit *Neu synchronisieren*, *Branch* (Suche, Synchronisiert / Wird synchronisiert / Nicht synchronisiert, Sync & Abbrechen), *Anzeige: Alle Dateien / Ignorierte Dateien / Nicht indiziert*, *Aus Projekt entfernen* · lokale Branches anlegen · ZIP-Export |
| **Quellen** | Neues Projekt aus Vorlage · lokalen Ordner öffnen (Chrome/Edge: Änderungen zurück in den Ordner schreiben) · GitHub-Repos importieren (öffentlich direkt, privat mit Token) · Dateien per Drag & Drop |
| **Vorschläge** | Liste wie in IntelliJ: farbige Typ-Icons (C, I, m, f, ⚡ …), Treffer blau markiert, Paket/Besitzer in Klammern · **Hover über einen Vorschlag** zeigt eine sehr kurze Erklärung und den Button **„Zur Dokumentation“**, der die passende Doku-Seite öffnet · JavaScript, TypeScript, HTML, CSS, Python, Java (+ Wörter aus der Datei für alle anderen Sprachen) |
| **Tastatur-Erkennung** | Vorschläge erscheinen **nur, wenn wirklich eine Tastatur benutzt wird** – unabhängig vom Gerät. PC/Laptop: immer. Handy/Tablet (auch iPad): erst wenn eine Hardware-Tastatur erkannt wird; sobald die Bildschirmtastatur erscheint, pausieren sie. In den Einstellungen umschaltbar (Automatisch / Immer / Nie). |
| **Live-Zusammenarbeit** | Link teilen → gemeinsam in denselben Dateien arbeiten. Der Cursor der anderen Person erscheint als farbiges **„\|“ mit Namensschild** darüber. Avatare oben, Punkte an Tabs/Dateien, „Folgen“ per Klick. Konfliktfrei dank Yjs (CRDT). |
| **Prüfungen** | Syntaxfehler (JS/TS/Python/Java/CSS/HTML …) und JSON-Fehler; grüner Haken bzw. rotes Zähler-Badge am Zeilenende, Liste im Panel „Probleme“ |
| **Ausführen** | ▶ öffnet HTML-/Markdown-Vorschau (CSS & JS des Projekts werden eingebunden) oder führt JavaScript aus – `console.log` landet in der Konsole |
| **Doku** | Eigene Kurz-Doku für alle Vorschläge (offline) mit Link zur vollständigen Referenz (MDN, Python-Doku, Java-API, TypeScript-Handbuch) |
| **PWA** | Installierbar, offline nutzbar (Service Worker), Window-Controls-Overlay am Desktop, Dateien aus dem Betriebssystem öffnen, App-Shortcuts |

## Starten

```bash
npm install        # nur für den Build nötig
npm run build      # bündelt CodeMirror/Yjs nach vendor/, kopiert Schriften, aktualisiert sw.js
npm start          # http://localhost:8080 – inkl. Live-Relay unter /collab
```

Die App selbst (`src/`) läuft ohne Build als ES-Module. `vendor/` ist bereits gebaut im Repo enthalten –
Luna kann also direkt als statische Seite gehostet werden (z. B. GitHub Pages).

### Live-Sessions über mehrere Geräte

* **Gleiches Gerät** (mehrere Tabs/Fenster): funktioniert immer, auch ohne Server.
* **Verschiedene Geräte**: braucht das kleine Relay aus `server.js` (ohne Abhängigkeiten, Node ≥ 18).
  Wird Luna über `npm start` ausgeliefert, findet die App das Relay automatisch.
  Bei statischem Hosting (GitHub Pages) den Server separat starten und die Adresse in
  *Einstellungen → Live-Server* eintragen (z. B. `wss://mein-server.de/collab`).

## Aufbau

```
index.html, manifest.webmanifest, sw.js    PWA-Grundgerüst
server.js                                  statischer Server + WebSocket-Relay für Live-Sessions
src/main.js                                Start, Layout, Tastenkürzel, PWA
src/core/        keyboard.js (Tastatur-Erkennung), langs.js, icons.js, db.js (IndexedDB), store.js
src/editor/      editor.js (Tabs/Panes/Statuszeile), completion.js (Vorschläge + Hover-Info),
                 diagnostics.js, theme.js
src/docs/        registry.js, view.js (Doku-Seiten), data/*.js (Kurzbeschreibungen je Sprache)
src/projects/    projects.js, github.js, folder.js, gitignore.js, templates.js
src/collab/      session.js (Yjs + Awareness, BroadcastChannel + WebSocket)
src/ui/          topbar.js, sidebar.js, menu.js, dialog.js, actions.js, panels.js, welcome.js
styles/app.css   Oberfläche inkl. Handy-Ansicht (≤ 760 px)
scripts/         build.mjs, icons.mjs, vendor/*.js (Bundle-Einstiegspunkte)
```

## Tastenkürzel (mit Tastatur)

| Aktion | Kürzel |
| --- | --- |
| Datei suchen | `Strg/⌘ + P` |
| Alle Befehle | `Strg/⌘ + ⇧ + P` |
| In Dateien suchen | `Strg/⌘ + ⇧ + F` |
| Ausführen / Vorschau | `Strg/⌘ + Enter` |
| Vorschläge öffnen | `Strg + Leertaste` |
| Ansicht teilen | `Strg/⌘ + \` |
| Seitenleiste / unteres Panel | `Strg/⌘ + B` / `Strg/⌘ + J` |
| Gehe zu Zeile | `Strg/⌘ + G` |
| Zurück / Vor | `Alt + ←` / `Alt + →` |

Alle Daten bleiben lokal im Browser (IndexedDB). Ein GitHub-Token wird nur lokal gespeichert.
