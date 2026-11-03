// Vorlagen für neue Projekte + das Demo-Projekt beim ersten Start.

const demo = {
  'README.md': `# Luna Demo

Willkommen in **Luna** – deiner Code-IDE im Browser.

- Tippe in einer \`.js\`-, \`.ts\`-, \`.html\`-, \`.css\`-, \`.py\`- oder \`.java\`-Datei: Vorschläge erscheinen,
  sobald eine Tastatur erkannt wurde (am PC immer).
- Fahre mit der Maus über einen Vorschlag: kurze Erklärung + Button zur Dokumentation.
- Oben rechts auf das Live-Symbol klicken, Link teilen – und zu zweit im selben Code arbeiten.
- Über **Repository hinzufügen** kannst du Ordner oder GitHub-Repos öffnen.
`,
  'index.html': `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Luna Demo</title>
  <link rel="stylesheet" href="src/styles.css">
</head>
<body>
  <main class="card">
    <h1>Hallo aus Luna 🌙</h1>
    <p>Drück auf ▶ (Ausführen), um diese Seite in der Vorschau zu sehen.</p>
    <button id="count">Klicks: 0</button>
  </main>
  <script type="module" src="src/app.js"></script>
</body>
</html>
`,
  'src/styles.css': `:root {
  --accent: #3574f0;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: Inter, system-ui, sans-serif;
  background: #0b0b0f;
  color: #e8e9ee;
}

.card {
  padding: 32px 40px;
  border-radius: 16px;
  background: #16161c;
  box-shadow: 0 20px 60px rgb(0 0 0 / .4);
}

button {
  padding: 10px 18px;
  border: 0;
  border-radius: 10px;
  background: var(--accent);
  color: white;
  font: inherit;
  cursor: pointer;
}
`,
  'src/app.js': `// Tipp: Schreib z. B. "document." oder "arr." und schau dir die Vorschläge an.
const button = document.querySelector('#count');
let clicks = 0;

button.addEventListener('click', () => {
  clicks++;
  button.textContent = \`Klicks: \${clicks}\`;
  console.log('Geklickt!', clicks);
});

const fruits = ['Apfel', 'Birne', 'Kiwi'];
const upper = fruits.map((f) => f.toUpperCase());
console.table(upper);
`,
  'src/rpc-node.ts': `import { JsonRpc, SocketTransport } from './rpc';

const domains = ['editor', 'files', 'live'];

export function connect(port: number = 63342) {
  const transport = new SocketTransport()
  const server = new JsonRpc(transport, domains)
  transport.connect(port)
  return server
}

export function close(server: JsonRpc) {
  server.close()
}
`,
  'src/rpc.ts': `export class SocketTransport {
  private socket?: WebSocket;

  connect(port: number) {
    this.socket = new WebSocket(\`ws://localhost:\${port}\`);
  }
}

export class JsonRpc {
  constructor(private transport: SocketTransport, private domains: string[]) {}

  close() {
    console.log('closing', this.domains.length, 'domains');
  }
}
`,
  'src/components/BranchMenu.tsx': `import Dropdown from '../../components/Dropdown/Normal';
import { BranchIcon } from '../../icons';
import { Commit } from '../../types/general';

type Props = {
  branches: string[];
  commits: Commit[];
};

export default function BranchMenu({ branches, commits }: Props) {
  return (
    <Dropdown
      items={branches.map((name) => ({ label: name, icon: <BranchIcon /> }))}
      hint={\`\${commits.length} Commits\`}
    />
  );
}
`,
  'main.py': `"""Kleines Python-Beispiel – tippe z. B. "pri" oder "zahlen." für Vorschläge."""


def quadrate(n: int) -> list[int]:
    return [i * i for i in range(n)]


if __name__ == "__main__":
    zahlen = quadrate(5)
    print("Quadrate:", zahlen)
`,
  'java/Main.java': `import java.util.List;
import java.util.concurrent.locks.ReadWriteLock;

public class Main {
    public static void main(String[] args) {
        List<String> namen = List.of("Ada", "Linus", "Grace");
        namen.forEach(System.out::println);
        // Tippe hier "Rea" – wie in Bild 3:
    }
}
`,
  'kotlin/CategoryRestController.kt': `package com.jet.save.controllers

@RestController
class CategoryRestController(private val categoryRepository: CategoryRepository) {

    @GetMapping
    @Transactional
    fun getAllEndpoint(): List<CategoryDto> {
        return categoryRepository
            .findAll()
            .map { convertCategoryToDto(it) }
            .sortedBy { it.title }
    }

    @GetMapping("/favorite")
    fun favoriteEndpoint(): CategoryDto {
        return CategoryDto(
            id = -1,
            type = "favorite",
            title = "My collection",
        )
    }
}
`,
  'docs/snippets/dev.Dockerfile': `FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
`,
  'docs/get_started/intro.md': `# Erste Schritte

1. Datei öffnen
2. Tippen
3. Live-Session starten
`,
  '.readthedocs.yml': `version: 2
build:
  os: ubuntu-24.04
  tools:
    python: "3.12"
mkdocs:
  configuration: mkdocs.yml
`,
  'package.json': `{
  "name": "luna-demo",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.js"
  }
}
`,
  '.gitignore': `node_modules/
dist/
*.log
.env
`,
  '.gitattributes': `* text=auto eol=lf
`,
  'LICENSE': `MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.
`,
  'dist/bundle.js': `// Build-Ausgabe (von .gitignore ignoriert)
console.log('bundle');
`,
};

const web = {
  'index.html': demo['index.html'],
  'src/styles.css': demo['src/styles.css'],
  'src/app.js': `const button = document.querySelector('#count');
let clicks = 0;
button.addEventListener('click', () => {
  clicks++;
  button.textContent = \`Klicks: \${clicks}\`;
});
`,
  'README.md': '# Neues Web-Projekt\n',
  '.gitignore': 'node_modules/\ndist/\n',
};

export const TEMPLATES = {
  empty: { name: 'Leer', files: { 'README.md': '# Neues Projekt\n' } },
  web: { name: 'Web (HTML, CSS, JS)', files: web },
  ts: { name: 'TypeScript', files: { 'src/index.ts': "export function greet(name: string): string {\n  return `Hallo ${name}`;\n}\n\nconsole.log(greet('Luna'));\n", 'tsconfig.json': '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "strict": true\n  }\n}\n', 'README.md': '# TypeScript-Projekt\n' } },
  python: { name: 'Python', files: { 'main.py': demo['main.py'], 'README.md': '# Python-Projekt\n' } },
  java: { name: 'Java', files: { 'src/Main.java': demo['java/Main.java'], 'README.md': '# Java-Projekt\n' } },
  demo: { name: 'Luna Demo', files: demo },
};
