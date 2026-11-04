// Vorschau-Modus mit Geräten: PC, Tablet und Handy in verschiedenen Größen (hoch/quer).
import { h, frag } from '../core/util.js';
import { icon } from '../core/icons.js';

export const DEVICES = [
  { id: 'fit', group: 'fit', name: 'Passend (ganze Fläche)', w: 0, h: 0 },
  { id: 'pc-1280', group: 'PC', name: 'Laptop 1280 × 800', w: 1280, h: 800, kind: 'pc' },
  { id: 'pc-1440', group: 'PC', name: 'Laptop 1440 × 900', w: 1440, h: 900, kind: 'pc' },
  { id: 'pc-1920', group: 'PC', name: 'Full HD 1920 × 1080', w: 1920, h: 1080, kind: 'pc' },
  { id: 'tab-ipad', group: 'Tablet', name: 'iPad 10,9″', w: 820, h: 1180, kind: 'tablet' },
  { id: 'tab-ipadpro', group: 'Tablet', name: 'iPad Pro 12,9″', w: 1024, h: 1366, kind: 'tablet' },
  { id: 'tab-mini', group: 'Tablet', name: 'iPad mini', w: 744, h: 1133, kind: 'tablet' },
  { id: 'tab-android', group: 'Tablet', name: 'Android-Tablet 11″', w: 800, h: 1280, kind: 'tablet' },
  { id: 'ph-iphone15', group: 'Handy', name: 'iPhone 15', w: 393, h: 852, kind: 'phone', island: true },
  { id: 'ph-iphone15pm', group: 'Handy', name: 'iPhone 15 Pro Max', w: 430, h: 932, kind: 'phone', island: true },
  { id: 'ph-iphonese', group: 'Handy', name: 'iPhone SE', w: 375, h: 667, kind: 'phone' },
  { id: 'ph-pixel', group: 'Handy', name: 'Pixel 8', w: 412, h: 915, kind: 'phone', punch: true },
  { id: 'ph-galaxy', group: 'Handy', name: 'Galaxy S24', w: 360, h: 780, kind: 'phone', punch: true },
];

/**
 * Baut einen Vorschau-Rahmen. content: Element, das im Gerät angezeigt wird.
 * Gibt { el, toolbar, setDevice, content } zurück.
 */
export function devicePreview(content, { device = 'fit', onChange } = {}) {
  let current = DEVICES.find((d) => d.id === device) || DEVICES[0];
  let landscape = false;
  const screen = h('div', { class: 'dv-screen' }, content);
  const frame = h('div', { class: 'dv-frame' }, h('span', { class: 'dv-notch' }), screen);
  const label = h('span', { class: 'dv-label' });
  const stage = h('div', { class: 'dv-stage' }, frame);
  const select = h('select', { class: 'dv-select', title: 'Gerät', onchange: (e) => setDevice(e.target.value) },
    ['fit', 'PC', 'Tablet', 'Handy'].map((g) => {
      const items = DEVICES.filter((d) => d.group === g);
      return g === 'fit' ? items.map((d) => h('option', { value: d.id }, d.name)) : h('optgroup', { label: g }, items.map((d) => h('option', { value: d.id }, d.name)));
    }));
  const quick = h('div', { class: 'dv-quick' },
    h('button', { class: 'icon-btn sm', title: 'Passend', onclick: () => setDevice('fit') }, frag(icon.fit)),
    h('button', { class: 'icon-btn sm', title: 'PC', onclick: () => setDevice('pc-1440') }, frag(icon.monitor)),
    h('button', { class: 'icon-btn sm', title: 'Tablet', onclick: () => setDevice('tab-ipad') }, frag(icon.tablet)),
    h('button', { class: 'icon-btn sm', title: 'Handy', onclick: () => setDevice('ph-iphone15') }, frag(icon.phone)));
  const rotate = h('button', { class: 'icon-btn sm', title: 'Drehen (hoch/quer)', onclick: () => { landscape = !landscape; layout(); } }, frag(icon.rotate));
  const toolbar = h('div', { class: 'dv-toolbar' }, quick, select, rotate, label);
  const el = h('div', { class: 'dv' }, toolbar, stage);

  function layout() {
    const fit = current.id === 'fit';
    el.classList.toggle('fit', fit);
    frame.className = 'dv-frame ' + (fit ? '' : current.kind) + (current.island ? ' island' : '') + (current.punch ? ' punch' : '') + (landscape ? ' landscape' : '');
    select.value = current.id;
    rotate.disabled = fit;
    [...quick.children].forEach((b, i) => b.classList.toggle('on', ['fit', 'PC', 'Tablet', 'Handy'][i] === (fit ? 'fit' : current.group)));
    if (fit) { screen.style.width = screen.style.height = ''; frame.style.transform = ''; frame.style.width = frame.style.height = ''; label.textContent = ''; return; }
    const w = landscape ? current.h : current.w;
    const hgt = landscape ? current.w : current.h;
    screen.style.width = w + 'px';
    screen.style.height = hgt + 'px';
    const pad = current.kind === 'phone' ? 26 : current.kind === 'tablet' ? 36 : 28;
    const fw = w + pad, fh = hgt + pad + (current.kind === 'pc' ? 6 : 0);
    const avail = stage.getBoundingClientRect();
    const scale = Math.min(1, (avail.width - 24) / fw, (avail.height - 24) / fh) || 1;
    frame.style.width = fw + 'px';
    frame.style.height = fh + 'px';
    frame.style.transform = `translate(-50%, -50%) scale(${scale})`;
    label.textContent = `${w} × ${hgt} · ${Math.round(scale * 100)} %`;
  }
  function setDevice(id) {
    current = DEVICES.find((d) => d.id === id) || DEVICES[0];
    if (current.kind !== 'phone' && current.kind !== 'tablet') landscape = false;
    layout();
    onChange?.(current.id);
  }
  new ResizeObserver(() => layout()).observe(stage);
  requestAnimationFrame(layout);
  return { el, toolbar, setDevice, screen, get device() { return current.id; } };
}
