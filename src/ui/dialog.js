// Modale Dialoge, Eingabeaufforderungen und Toasts.
import { h, frag } from '../core/util.js';
import { icon } from '../core/icons.js';
import { app } from '../core/store.js';

export function openDialog({ title, body, actions = [], wide = false, onClose, className = '' }) {
  const close = (value) => { overlay.remove(); onClose?.(value); resolve(value); };
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const footer = actions.length ? h('footer', { class: 'dlg-actions' }, actions.map((a) => h('button', {
    class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), type: a.submit ? 'submit' : 'button',
    onclick: async (e) => {
      if (a.submit) return;
      e.preventDefault();
      const r = a.onClick ? await a.onClick() : a.value;
      if (r !== false) close(r);
    },
  }, a.label))) : null;
  const form = h('form', { class: 'dialog ' + (wide ? 'wide ' : '') + className, role: 'dialog', 'aria-modal': 'true',
    onsubmit: async (e) => {
      e.preventDefault();
      const a = actions.find((x) => x.submit);
      if (!a) return;
      const r = a.onClick ? await a.onClick() : a.value;
      if (r !== false) close(r);
    } },
  h('header', { class: 'dlg-head' }, h('h2', {}, title), h('button', { class: 'icon-btn sm', type: 'button', title: 'Schließen', onclick: () => close(null) }, frag(icon.close))),
  h('div', { class: 'dlg-body' }, body),
  footer);
  const overlay = h('div', { class: 'overlay', onpointerdown: (e) => { if (e.target === overlay) close(null); } }, form);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } });
  document.body.append(overlay);
  requestAnimationFrame(() => (form.querySelector('[autofocus]') || form.querySelector('input,select,textarea,button.primary'))?.focus());
  return { promise, close, el: form };
}

export function prompt(title, { value = '', placeholder = '', label = '', ok = 'OK', selectBase = false } = {}) {
  const input = h('input', { class: 'input', value, placeholder, autofocus: true, autocomplete: 'off', spellcheck: 'false' });
  const d = openDialog({
    title,
    body: [label ? h('label', { class: 'field-label' }, label) : null, input],
    actions: [{ label: 'Abbrechen', value: null }, { label: ok, primary: true, submit: true, onClick: () => input.value.trim() || false }],
  });
  requestAnimationFrame(() => {
    input.focus();
    if (selectBase) { const dot = value.lastIndexOf('.'); input.setSelectionRange(value.lastIndexOf('/') + 1, dot > value.lastIndexOf('/') + 1 ? dot : value.length); }
    else input.select();
  });
  return d.promise;
}

export function confirm(title, text, { ok = 'OK', danger = false } = {}) {
  return openDialog({
    title,
    body: h('p', { class: 'dlg-text' }, text),
    actions: [{ label: 'Abbrechen', value: false }, { label: ok, primary: !danger, danger, submit: true, value: true }],
  }).promise;
}

// ---------- Toasts ----------
let toastRoot;
export function toast(text, { type = 'info', timeout = 3500, action } = {}) {
  if (!toastRoot) { toastRoot = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.append(toastRoot); }
  const el = h('div', { class: 'toast ' + type },
    frag(type === 'error' ? icon.error : type === 'success' ? icon.check : icon.info),
    h('span', {}, text),
    action ? h('button', { class: 'btn sm', onclick: () => { action.onClick(); el.remove(); } }, action.label) : null);
  toastRoot.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, timeout);
}

app.on('notification', (n) => { if (!n.silent) toast(n.text, { type: n.type }); });
