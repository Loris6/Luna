// Vorlagen für neue Projekte + das Demo-Projekt beim ersten Start – erstmal nur Luna.

const README = `# Luna Demo

Willkommen in **Luna** – deiner Code-IDE im Browser für die Sprache Luna.

Luna ist wie Luau (Roblox), aber für alle:

- \`local\` – nur in dieser Datei · \`let\` – überall änderbar · \`const\` – überall lesbar, nicht änderbar
- Funktionen enden mit \`end)\`, if/else/Schleifen mit \`end\`
- \`import Html\` fügt die 2D-Oberfläche hinzu, \`import discord\` einen (simulierten) Discord-Bot

Drück ▶ (oder Strg/⌘ + Enter): Alle .luna-Dateien laufen gleichzeitig, \`main.luna\` zuerst.
Mehr im **Luna-Handbuch** (Seitenleiste → Docs).
`;

const demo = {
  'main.luna': `-- Luna Demo: 2D-Button, Zähler und Countdown
import Html

let button = create("Button")
button.innerText = "Klick mich"

button.click:ConnectTo(function()
  button.innerText = "Test"
  sayHello("Luna")
end)

-- Ein Schalter (Toggle), der jede Sekunde hochzählt, solange er an ist
let toggle = create("Toggle")
toggle.innerText = "Zähler: 0"
let count = 0

toggle.changed:ConnectTo(function(an)
  while toggle.checked and wait(1) do -- jede Sekunde --
    count += 1
    toggle.innerText = "Zähler: {count}"
  end
end)

-- Countdown von 10 bis 1 (Schritt -1)
local anzeige = create("Text")
spawn(function()
  for i = 10, 1, -1 do
    anzeige.innerText = "Countdown: {i}"
    wait(1)
  end
  anzeige.innerText = "Los!"
end)

local number = 7
if number <= 10 then
  print("number is smaller than 10")
else
  print("Number is bigger than 10")
end
`,
  'helfer.luna': `-- Funktionen ohne local sind auch in anderen Scripts aufrufbar
function sayHello(name)
  print("Hallo {name}!")
  print(geheimeZahl())
end)

-- local: nur in dieser Datei aufrufbar
local function geheimeZahl()
  return MAX_PUNKTE / 2
end)

const MAX_PUNKTE = 100   -- überall lesbar, aber nicht änderbar
`,
  'README.md': README,
};

const empty = {
  'main.luna': `print("Hallo Welt")
`,
};

const ui = {
  'main.luna': `import Html

let titel = create("Text")
titel.innerText = "Mein erstes Fenster"
titel.fontSize = 22

let name = create("TextBox")
name.placeholder = "Wie heißt du?"

let button = create("Button")
button.innerText = "Begrüßen"

button.click:ConnectTo(function()
  if name.text == "" then
    titel.innerText = "Bitte Namen eingeben"
  else
    titel.innerText = "Hallo {name.text}!"
  end
end)
`,
};

const countdown = {
  'main.luna': `import Html

let anzeige = create("Text")
anzeige.fontSize = 40
let start = create("Button")
start.innerText = "Countdown starten"

start.click:ConnectTo(function()
  start.visible = false
  for i = 60, 1, -1 do -- ab 60, bis 1, Schritt -1
    anzeige.innerText = i
    wait(1)
  end
  anzeige.innerText = "Fertig!"
  start.visible = true
end)
`,
};

const discordBot = {
  'bot.luna': `import discord
discord.name = "LunaBot"

discord.send("Ich bin online! Schreib !ping oder !würfel")

discord.message:ConnectTo(function(msg)
  if msg.content == "!ping" then
    msg:reply("pong")
  else if msg.content == "!würfel" then
    msg:reply("Du würfelst eine {math.random(1, 6)}")
  end
  end
end)
`,
};

export const TEMPLATES = {
  empty: { name: 'Leer (Luna)', files: empty },
  ui: { name: '2D-Oberfläche', files: ui },
  countdown: { name: 'Countdown', files: countdown },
  discord: { name: 'Discord-Bot (Simulation)', files: discordBot },
  demo: { name: 'Luna Demo', files: demo },
};

export const DEMO_VERSION = 2;
