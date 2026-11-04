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
| **Konto (Pflicht)** | Ohne Konto mit E-Mail-Adresse geht nichts. Anmeldung **mit Google** oder E-Mail + Passwort. Mit Luna-Server werden Projekte, Webhooks und die GitHub-Verbindung zwischen **PC, Handy und Tablet** synchronisiert (neuere Änderung gewinnt). |
| **Dashboard** | Übersicht, Projekte, Verbindungen (GitHub, Google, Discord, Luna-Server), Webhooks, Einstellungen – links Navigation am Desktop, auf dem Handy **iOS-Tab-Bar** (Apple-Geräte) bzw. **normaler Footer** (Android) |
| **Sicherheit** | App-Passwort oder geräteabhängig **Face ID / Touch ID / Fingerabdruck / Windows Hello** · App beim Öffnen und nach Inaktivität sperren · „Passwort vergessen?“ → richtige Konto-E-Mail → neues Passwort |
| **Webhooks** | Eigene Webhooks (z. B. Discord) mit API-Secret – anzeigen, kopieren, neu erzeugen und löschen nur nach Bestätigung · in Luna: `import Webhook` → `Webhook.send("Name", "Text")` |
| **GitHub** | Mit Token verbinden, eigene Repositories auswählen und importieren, **Änderungen pushen** (Commit auf den aktuellen Branch) |
| **Vorschau** | Überall mit Geräte-Modus: Passend, PC (1280/1440/1920), Tablet (iPad, iPad Pro, iPad mini, Android), Handy (iPhone 15, 15 Pro Max, SE, Pixel 8, Galaxy S24) – hoch und quer |
| **Doku** | Eigene Seite **docs.html**: Handbuch, Referenz, Suche (`Strg/⌘ K`), jedes Beispiel direkt ausführbar mit Geräte-Vorschau |
| **Bedienung** | Kein elastisches Nachfedern/Überscrollen – weder in Listen noch im Editor; kein Zoom beim Tippen auf iOS |
| **PWA** | Installierbar, offline nutzbar (Service Worker), Window-Controls-Overlay am Desktop, Dateien aus dem Betriebssystem öffnen, App-Shortcuts · App-Icon = Luna-Logo auf Weiß |

## Starten

```bash
npm install        # nur für den Build nötig
npm run build      # bündelt CodeMirror/Yjs nach vendor/, kopiert Schriften, aktualisiert sw.js
npm start          # http://localhost:8080 – inkl. Live-Relay unter /collab
```

Die App selbst (`src/`) läuft ohne Build als ES-Module. `vendor/` ist bereits gebaut im Repo enthalten –
Luna kann also direkt als statische Seite gehostet werden (z. B. GitHub Pages).

### Konten, Sync und Google-Anmeldung

`server.js` (ohne Abhängigkeiten) stellt neben den Dateien auch die Konto- und Sync-API unter `/api` bereit.
Daten liegen in `./data` (bzw. `LUNA_DATA=/pfad`) – Passwörter nur als scrypt-Hash.

```bash
GOOGLE_CLIENT_ID=123….apps.googleusercontent.com LUNA_DATA=/var/luna npm start
```

* **Google-Anmeldung:** In der [Google Cloud Console](https://console.cloud.google.com/apis/credentials) eine
  OAuth-Client-ID (Typ „Webanwendung“) anlegen und die Adresse der App unter „Autorisierte JavaScript-Quellen“
  eintragen. Die ID als `GOOGLE_CLIENT_ID` setzen oder in `luna.config.json` (`googleClientId`) eintragen.
  Gleiche E-Mail-Adresse = gleiches Konto, egal ob per Google oder Passwort angemeldet.
* **Ohne Server** (z. B. reines GitHub-Pages-Hosting) funktioniert Luna weiter – das Konto gilt dann nur auf dem
  jeweiligen Gerät. Eine Server-Adresse lässt sich auf der Anmeldeseite („Server ändern“) oder in
  `luna.config.json` (`serverUrl`) hinterlegen.
* **Face ID / Fingerabdruck** nutzt WebAuthn und braucht HTTPS (oder `localhost`).

### Logo & Icons

`icons/logo-original.png` ist das Original. `python3 scripts/make-icons.py` erzeugt daraus die App-Icons
(weißer Hintergrund, etwas kleiner skaliert) und das transparente Logo für `.luna`-Dateien.

### Live-Sessions über mehrere Geräte

* **Gleiches Gerät** (mehrere Tabs/Fenster): funktioniert immer, auch ohne Server.
* **Verschiedene Geräte**: braucht das kleine Relay aus `server.js` (ohne Abhängigkeiten, Node ≥ 18).
  Wird Luna über `npm start` ausgeliefert, findet die App das Relay automatisch.
  Bei statischem Hosting (GitHub Pages) den Server separat starten und die Adresse in
  *Einstellungen → Live-Server* eintragen (z. B. `wss://mein-server.de/collab`).

## Aufbau

```
index.html, docs.html, manifest, sw.js     App, Doku-Seite, PWA-Grundgerüst
server.js                                  Dateien + Konto/Sync-API (/api) + WebSocket-Relay (/collab)
luna.config.json                           googleClientId, serverUrl
src/main.js                                Start: Anmeldung → Sperre → Dashboard/Editor
src/docs-page.js                           die Doku-Seite
src/core/        auth.js (Konto, Google), sync.js, secure.js (Passwort/Face ID/Fingerabdruck), webhooks.js,
                 platform.js (iOS/Android), keyboard.js, langs.js, icons.js, db.js (IndexedDB je Konto), store.js
src/config.js    welche Sprachen aktiv sind (erstmal nur Luna)
src/luna/        parser.js (Lexer/Parser), runtime.js (Interpreter + Html/discord/Http/Storage),
                 language.js (Einfärbung, Einrückung, auto end), analysis.js (Prüfung), project.js
src/editor/      editor.js (Tabs/Panes/Statuszeile), completion.js (Vorschläge + Hover-Info),
                 diagnostics.js, theme.js
src/docs/        registry.js, view.js (Doku-Seiten, Handbuch), data/luna.js (+ abgeschaltete Sprachen)
src/projects/    projects.js, github.js, folder.js, gitignore.js, templates.js
src/collab/      session.js (Yjs + Awareness, BroadcastChannel + WebSocket)
src/ui/          shell.js (Ansichten + Footer), home.js (Dashboard), login.js, preview.js (Geräte),
                 topbar.js, sidebar.js, menu.js, dialog.js, actions.js, panels.js, welcome.js
styles/          app.css (Editor), home.css (Dashboard, Anmeldung, Footer), preview.css, docs.css
scripts/         build.mjs, make-icons.py, vendor/*.js (Bundle-Einstiegspunkte)
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

Projekte liegen im Browser (IndexedDB, getrennt je Konto) und – mit Luna-Server – zusätzlich in deinem Konto auf dem Server.
