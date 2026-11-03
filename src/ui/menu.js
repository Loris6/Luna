// Dropdown-/Kontextmenüs mit Untermenüs (Bild 1: „…“-Menü mit Branch-Untermenü).
import { h, frag, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';

const stack = [];

export function closeMenus(level = 0) {
  while (stack.length > level) {
    const m = stack.pop();
    m.el.remove();
    m.onClose?.();
  }
}

function place(el, anchor, { align = 'start', side = 'bottom' } = {}) {
  const vw = innerWidth, vh = innerHeight;
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let x, y;
  if (side === 'right') {
    x = r.right + 4; y = r.top - 6;
    if (x + mw > vw - 8) x = r.left - mw - 4;
  } else {
    x = align === 'end' ? r.right - mw : r.left;
    y = r.bottom + 6;
    if (y + mh > vh - 8 && r.top - mh - 6 > 8) y = r.top - mh - 6;
  }
  el.style.left = clamp(x, 8, Math.max(8, vw - mw - 8)) + 'px';
  el.style.top = clamp(y, 8, Math.max(8, vh - mh - 8)) + 'px';
}

const isNarrow = () => innerWidth < 640;

export function showMenu(anchor, items, opts = {}) {
  const level = opts.level || 0;
  closeMenus(level);
  const el = h('div', { class: 'menu ' + (opts.className || ''), role: 'menu', tabindex: '-1' });
  const entry = { el, onClose: opts.onClose };
  stack.push(entry);
  document.body.append(el);
  const rows = [];
  let hoverTimer;

  const openSub = (row, item) => {
    closeMenus(level + 1);
    rows.forEach((r) => r.classList.toggle('open', r === row));
    const sub = typeof item.submenu === 'function' ? item.submenu() : item.submenu;
    if (isNarrow()) {
      // Auf schmalen Bildschirmen ersetzt das Untermenü den Inhalt (mit Zurück)
      const back = h('button', { class: 'menu-item back', onclick: () => showMenu(anchor, items, opts) }, frag(icon.arrowLeft), h('span', { class: 'label' }, item.label));
      el.replaceChildren(back, h('div', { class: 'menu-sep' }));
      if (sub instanceof Node) el.append(sub); else buildItems(el, sub);
      place(el, anchor, opts);
      return;
    }
    if (sub instanceof Node) {
      const panel = h('div', { class: 'menu submenu-panel', role: 'menu' }, sub);
      stack.push({ el: panel });
      document.body.append(panel);
      place(panel, row, { side: 'right' });
      panel.querySelector('input')?.focus();
    } else showMenu(row, sub, { level: level + 1, side: 'right', className: opts.className });
  };

  const buildItems = (container, list) => {
    for (const item of list) {
      if (!item) continue;
      if (item === '-') { container.append(h('div', { class: 'menu-sep' })); continue; }
      if (item.section) { container.append(h('div', { class: 'menu-section' }, item.section)); continue; }
      if (item.custom) { container.append(item.custom); continue; }
      const row = h('button', {
        class: 'menu-item' + (item.danger ? ' danger' : '') + (item.submenu ? ' has-sub' : '') + (item.active ? ' active' : ''),
        role: 'menuitem', disabled: item.disabled || null, type: 'button',
      },
      item.icon ? frag(item.icon) : (item.color ? h('span', { class: 'menu-dot', style: { background: item.color } }) : h('span', { class: 'menu-ic-space' })),
      h('span', { class: 'label' }, item.label),
      item.hint ? h('span', { class: 'hint' }, item.hint) : null,
      item.shortcut ? h('kbd', { class: 'shortcut kb-only' }, item.shortcut) : null,
      item.checked ? h('span', { class: 'check' }, frag(icon.check)) : null,
      item.submenu ? h('span', { class: 'sub-caret' }, frag(icon.caretRight)) : null);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.submenu) { openSub(row, item); return; }
        if (!item.keepOpen) closeMenus(0);
        item.onClick?.(e);
      });
      row.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse') return;
        row.focus({ preventScroll: true });
        clearTimeout(hoverTimer);
        if (item.submenu) hoverTimer = setTimeout(() => openSub(row, item), 120);
        else if (stack.length > level + 1) hoverTimer = setTimeout(() => { closeMenus(level + 1); rows.forEach((r) => r.classList.remove('open')); }, 200);
      });
      rows.push(row);
      container.append(row);
    }
  };
  buildItems(el, items);
  place(el, anchor, opts);
  if (!opts.noFocus) requestAnimationFrame(() => (el.querySelector('input') || el).focus({ preventScroll: true }));

  el.addEventListener('keydown', (e) => {
    const focusables = [...el.querySelectorAll('.menu-item:not([disabled])')];
    const i = focusables.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusables[(i + 1) % focusables.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusables[(i - 1 + focusables.length) % focusables.length]?.focus(); }
    else if (e.key === 'ArrowRight' && document.activeElement?.classList.contains('has-sub')) { e.preventDefault(); document.activeElement.click(); }
    else if (e.key === 'ArrowLeft' && level > 0) { e.preventDefault(); closeMenus(level); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenus(level); }
  });
  return el;
}

addEventListener('pointerdown', (e) => {
  if (!stack.length) return;
  if (stack.some((m) => m.el.contains(e.target))) return;
  closeMenus(0);
}, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) closeMenus(stack.length - 1); });
addEventListener('resize', () => closeMenus(0));
addEventListener('blur', () => closeMenus(0));
