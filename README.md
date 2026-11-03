# 🌙 Luna – Code-Editor im Browser

Luna ist eine Code-Editor-IDE als Webseite für die Programmiersprache **Luna**. Sie lässt sich als **PWA** installieren
und funktioniert **offline** – auf PC, Tablet und Handy (mit eigener Handy-Ansicht).

> **Luna** = für alle (dieses Repo) · **Lunar** = dieselbe Idee, speziell für Roblox optimiert (eigenes Repo).

## Die Sprache Luna

Luna ist wie Luau (Roblox) – nur für jedermann. Erstmal unterstützt die IDE **nur Luna** (`.luna`);
andere Dateien öffnen sich als einfacher Text. Weitere Sprachen lassen sich später in `src/config.js` einschalten.

```luna
import Html                      -- Bibliothek hinzufügen (Html, discord, Http, Storage)

local geheim = 1                 -- nur in dieser Datei
let count = 0                    -- überall änderbar und aufrufbar
const MAX = 60                   -- überall aufrufbar, nicht änderbar

function sayHello()              -- Funktionen enden IMMER mit end)
  print("Hello")
end)

local function nurHier() end)    -- local: nur in diesem Script aufrufbar

if count <= 10 then              -- if / else / else if enden mit end (ohne Klammer)
  print("kleiner als 10")
else if count <= 20 then
  print("bis 20")
end                              -- „else if“ braucht ein eigenes end
end

let button = create("Button")    -- 2D-Button
button.click:ConnectTo(function()
  button.innerText = "Test"
end)                             -- end) schließt Funktion UND ConnectTo(

while wait(1) do                 -- jede Sekunde
  count += 1
end

for i = 60, 1, -1 do             -- ab 60, bis 1, Schritt -1 (Countdown)
  count = i
  wait(1)
end
```

Außerdem: `"Hallo {name}"`-Platzhalter, `..` oder `+` zum Verbinden von Texten, Tabellen/Listen (ab 1),
`math`, `string` (`text:upper()`), `table`, `pairs`/`ipairs`, `spawn`, `delay`, `repeat … until`,
Kommentare mit `--`, `-- mitten in der Zeile --` und `--[[ … ]]`. Das komplette **Luna-Handbuch** ist in der App
(Seitenleiste → Docs), jedes Beispiel lässt sich dort mit „Ausprobieren“ starten.

## Funktionen

| Bereich | Was Luna kann |
| --- | --- |
| **Oberfläche** | Titelleiste mit Workspace, Zurück/Vor, Verlauf · Seitenleiste mit *Repos / Docs / Suche* · Tabs, Datei-Kopfzeile, Statuszeile (Pfad / Symbol, `Ln 17, Col 42`, `UTF-8`, Sprache) · geteilte Ansicht (untereinander oder nebeneinander) |
| **Repos** | Mehrere Repositories im Workspace · „…“-Menü mit *Neu synchronisieren*, *Branch* (Suche, Synchronisiert / Wird synchronisiert / Nicht synchronisiert, Sync & Abbrechen), *Anzeige: Alle Dateien / Ignorierte Dateien / Nicht indiziert*, *Aus Projekt entfernen* · lokale Branches anlegen · ZIP-Export |
| **Quellen** | Neues Projekt aus Vorlage · lokalen Ordner öffnen (Chrome/Edge: Änderungen zurück in den Ordner schreiben) · GitHub-Repos importieren (öffentlich direkt, privat mit Token) · Dateien per Drag & Drop |
| **Vorschläge** | Liste wie in IntelliJ: farbige Typ-Icons, Treffer blau markiert, Herkunft in Klammern · **Hover über einen Vorschlag** zeigt eine sehr kurze Erklärung und den Button **„Zur Dokumentation“** · kennt Schlüsselwörter, eingebaute Funktionen, `create("…")`-Typen, Eigenschaften & Ereignisse (`button.click:ConnectTo`), Funktionen/`let`/`const` aus anderen Scripts · schlägt den richtigen Abschluss vor (`end` oder `end)`) · `create` fügt `import Html` automatisch hinzu · Enter nach `then`/`do`/`function()` setzt den Abschluss automatisch |
| **Tastatur-Erkennung** | Vorschläge erscheinen **nur, wenn wirklich eine Tastatur benutzt wird** – unabhängig vom Gerät. PC/Laptop: immer. Handy/Tablet (auch iPad): erst wenn eine Hardware-Tastatur erkannt wird; sobald die Bildschirmtastatur erscheint, pausieren sie. In den Einstellungen umschaltbar (Automatisch / Immer / Nie). |
| **Live-Zusammenarbeit** | Link teilen → gemeinsam in denselben Dateien arbeiten. Der Cursor der anderen Person erscheint als farbiges **„\|“ mit Namensschild** darüber. Avatare oben, Punkte an Tabs/Dateien, „Folgen“ per Klick. Konfliktfrei dank Yjs (CRDT). |
| **Prüfungen** | Luna-Regeln mit verständlichen Meldungen und Ein-Klick-Korrektur: Funktion ohne `end)`, `if … end)`, `const` geändert, `create` ohne `import Html`, `local`-Funktion aus einem anderen Script aufgerufen, unbekannte Namen · grüner Haken bzw. rotes Zähler-Badge am Zeilenende, Liste im Panel „Probleme“ |
| **Ausführen** | ▶ bzw. `Strg/⌘ + Enter` startet alle `.luna`-Scripts des Projekts gleichzeitig (`main.luna` zuerst) · `print` erscheint in der Konsole (mit Sprung zur Zeile) · Buttons, Texte, Schalter … in der Vorschau rechts · `discord` als Test-Chat · Stopp mit ■ oder `⇧F5` |
| **Doku** | Luna-Handbuch + Kurz-Doku zu jedem Vorschlag mit Beispiel – alles offline |
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
src/config.js    welche Sprachen aktiv sind (erstmal nur Luna)
src/luna/        parser.js (Lexer/Parser), runtime.js (Interpreter + Html/discord/Http/Storage),
                 language.js (Einfärbung, Einrückung, auto end), analysis.js (Prüfung), project.js
src/editor/      editor.js (Tabs/Panes/Statuszeile), completion.js (Vorschläge + Hover-Info),
                 diagnostics.js, theme.js
src/docs/        registry.js, view.js (Doku-Seiten, Handbuch), data/luna.js (+ abgeschaltete Sprachen)
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
| Luna ausführen / stoppen | `Strg/⌘ + Enter` / `⇧ + F5` |
| Vorschläge öffnen | `Strg + Leertaste` |
| Ansicht teilen | `Strg/⌘ + \` |
| Seitenleiste / unteres Panel | `Strg/⌘ + B` / `Strg/⌘ + J` |
| Gehe zu Zeile | `Strg/⌘ + G` |
| Zurück / Vor | `Alt + ←` / `Alt + →` |

Alle Daten bleiben lokal im Browser (IndexedDB). Ein GitHub-Token wird nur lokal gespeichert.
