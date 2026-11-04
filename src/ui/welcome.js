// Willkommen-Tab + Tastenleiste für Bildschirmtastaturen (Handy/Tablet ohne Hardware-Tastatur).
import { h, frag, basename, dirname, modKey } from '../core/util.js';
import { icon, fileIcon } from '../core/icons.js';
import { app } from '../core/store.js';
import { keyboard } from '../core/keyboard.js';
import { getProject } from '../projects/projects.js';
import { openFile, recentFiles, activeTab } from '../editor/editor.js';
import { indentMore, cursorCharLeft, cursorCharRight, cursorLineUp, cursorLineDown } from '../../vendor/core.js';
import { newProjectDialog, githubDialog, joinDialog, quickOpen, commandPalette } from './actions.js';
import { openFolder } from '../projects/folder.js';

export function renderWelcome(el) {
  const action = (ic, title, desc, onclick) => h('button', { class: 'wl-action', onclick }, frag(ic), h('span', {}, h('strong', {}, title), h('span', { class: 'muted' }, desc)));
  const recent = recentFiles().slice(0, 6);
  el.replaceChildren(h('div', { class: 'welcome' },
    h('div', { class: 'wl-hero' },
      h('img', { src: 'icons/icon-192.png', alt: '', class: 'wl-logo', width: 72, height: 72 }),
      h('div', {}, h('h1', {}, 'Luna'), h('p', { class: 'muted' }, 'Die IDE für die Sprache Luna – wie Luau, aber für alle. Offline nutzbar, als App installierbar, gemeinsam live bearbeiten.'))),
    h('div', { class: 'wl-grid' },
      h('section', {},
        h('h2', {}, 'Loslegen'),
        action(icon.newFolder, 'Neues Projekt', 'Leer oder aus einer Vorlage', newProjectDialog),
        action(icon.folderOpen, 'Ordner öffnen', 'Lokalen Projektordner bearbeiten', () => openFolder().catch(() => {})),
        action(icon.github, 'Von GitHub', 'Repository & Branches importieren', githubDialog),
        action(icon.broadcast, 'Live-Session beitreten', 'Mit anderen gemeinsam coden', joinDialog),
        action(icon.book, 'Luna-Handbuch', 'local, let, const, function … end), import Html …', () => app.emit('open-guide', 'start'))),
      h('section', {},
        h('h2', {}, 'Zuletzt geöffnet'),
        recent.length ? recent.map((r) => {
          const p = getProject(r.projectId);
          return h('button', { class: 'wl-recent', onclick: () => openFile(p, r.path) }, frag(fileIcon(r.path)), h('span', { class: 'name' }, basename(r.path)), h('span', { class: 'muted' }, `${p.name} / ${dirname(r.path)}`));
        }) : h('p', { class: 'muted' }, 'Noch nichts – öffne links eine Datei.'),
        h('div', { class: 'wl-keys kb-only' },
          h('h2', {}, 'Tastenkürzel'),
          [['Datei suchen', `${modKey}P`], ['Alle Befehle', `${modKey}⇧P`], ['In Dateien suchen', `${modKey}⇧F`], ['Ausführen', `${modKey}↵`], ['Vorschläge öffnen', `${modKey}Leertaste`], ['Ansicht teilen', `${modKey}\\`]]
            .map(([l, k]) => h('div', { class: 'wl-key' }, h('span', {}, l), h('kbd', {}, k)))))),
    h('p', { class: 'wl-foot muted small' }, h('span', { class: 'kb-state' }, frag(icon.keyboard), keyboard.describe())),
  ));
  el.querySelector('.wl-hero h1').addEventListener('dblclick', () => commandPalette());
}

// ---------- Tastenleiste über der Bildschirmtastatur ----------
export function initKeyBar() {
  const keys = [
    ['⇥', (v) => indentMore(v)], ['{'], ['}'], ['('], [')'], ['['], [']'], [';'], ['='], ['"'], ["'"], ['<'], ['>'], ['/'], ['.'],
    ['←', cursorCharLeft], ['→', cursorCharRight], ['↑', cursorLineUp], ['↓', cursorLineDown],
  ];
  const bar = h('div', { class: 'keybar', hidden: true }, keys.map(([label, cmd]) => h('button', {
    class: 'kbtn', type: 'button',
    onpointerdown: (e) => e.preventDefault(),
    onclick: () => {
      const v = activeTab()?.view;
      if (!v) return;
      if (cmd) cmd(v); else v.dispatch(v.state.replaceSelection(label));
      v.focus();
    },
  }, label)));
  document.body.append(bar);
  const vv = window.visualViewport;
  const update = () => {
    const show = keyboard.virtualKeyboardVisible && !!document.activeElement?.closest?.('.cm-editor');
    bar.hidden = !show;
    if (show && vv) bar.style.transform = `translateY(${vv.offsetTop + vv.height - innerHeight}px)`;
  };
  keyboard.on('virtual-keyboard', update);
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);
  document.addEventListener('focusin', () => setTimeout(update, 400));
  document.addEventListener('focusout', () => setTimeout(update, 100));
}

export { quickOpen };
