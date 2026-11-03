// Erkennt, ob tatsächlich eine (Hardware-)Tastatur benutzt wird – unabhängig vom Gerätetyp.
//
// Regeln:
//  • PC/Laptop (Maus oder Trackpad als Haupteingabe)            → Vorschläge immer an.
//  • Touch-Geräte (Handy, Tablet, iPad …)                        → nur an, wenn eine echte Tastatur erkannt wird.
//
// Signale für eine echte Tastatur auf Touch-Geräten:
//  • keydown mit physischem `code` (KeyA, Digit1 …) während KEINE Bildschirmtastatur sichtbar ist
//  • Tasten, die es auf Bildschirmtastaturen praktisch nicht gibt (Tab, Esc, Pfeile, F-Tasten, Strg/⌘-Kombis)
// Signal für „keine Tastatur“:
//  • Bildschirmtastatur erscheint (visualViewport schrumpft deutlich bzw. VirtualKeyboard-API meldet Höhe)
import { Emitter } from './util.js';

const STORAGE_KEY = 'luna.hwKeyboard';
const PHYSICAL_ONLY = /^(Tab|Escape|Arrow(Up|Down|Left|Right)|F\d{1,2}|Home|End|PageUp|PageDown|Insert|Delete)$/;
const PHYSICAL_CODE = /^(Key[A-Z]|Digit\d|Numpad|Space|Enter|Backspace|Minus|Equal|Bracket|Semicolon|Quote|Backquote|Backslash|Comma|Period|Slash|Shift|Control|Alt|Meta|CapsLock|IntlBackslash)/;

class KeyboardDetector extends Emitter {
  constructor() {
    super();
    const mq = (q) => window.matchMedia(q).matches;
    // „PC“: Haupteingabe ist Maus/Trackpad mit Hover.
    this.isDesktop = mq('(pointer: fine)') && mq('(hover: hover)');
    this.hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    let stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch {}
    this.detected = this.isDesktop ? true : stored === '1';
    this.virtualKeyboardVisible = false;
    this.maxViewport = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    this.mode = 'auto';
    this._install();
  }

  /** Effektiver Zustand: sollen Vorschläge gezeigt werden? */
  get present() {
    if (this.mode === 'on') return true;
    if (this.mode === 'off') return false;
    return this.isDesktop || this.detected;
  }

  setMode(mode) {
    this.mode = mode;
    this.emit('change', this.present);
  }

  _set(value, reason) {
    if (this.isDesktop || this.detected === value) return;
    this.detected = value;
    try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch {}
    this.lastReason = reason;
    this.emit('change', this.present);
  }

  _install() {
    window.addEventListener('keydown', (e) => {
      if (this.isDesktop) return;
      if (e.isComposing || e.keyCode === 229 || e.key === 'Unidentified' || !e.code) return;
      const strong = PHYSICAL_ONLY.test(e.key) || ((e.ctrlKey || e.metaKey) && /^Key[A-Z]$/.test(e.code));
      const medium = PHYSICAL_CODE.test(e.code) && !this.virtualKeyboardVisible;
      if (strong || medium) this._set(true, `Taste ${e.code}`);
    }, true);

    const vv = window.visualViewport;
    const check = () => {
      const h = vv ? vv.height : window.innerHeight;
      // Bei Drehung neu kalibrieren
      if (h > this.maxViewport || Math.abs(window.innerWidth - (this._lastW || window.innerWidth)) > 100) this.maxViewport = h;
      this._lastW = window.innerWidth;
      const vkHeight = navigator.virtualKeyboard?.boundingRect?.height || 0;
      const shrunk = this.maxViewport - h > Math.max(150, this.maxViewport * 0.22);
      const visible = vkHeight > 50 || (shrunk && this._editableFocused());
      if (visible !== this.virtualKeyboardVisible) {
        this.virtualKeyboardVisible = visible;
        this.emit('virtual-keyboard', visible);
        if (visible && this.hasTouch) this._set(false, 'Bildschirmtastatur sichtbar');
      }
    };
    this._check = check;
    if (vv) { vv.addEventListener('resize', check); vv.addEventListener('scroll', check); }
    window.addEventListener('resize', check);
    if (navigator.virtualKeyboard) navigator.virtualKeyboard.addEventListener?.('geometrychange', check);
    document.addEventListener('focusin', () => setTimeout(check, 350));
    document.addEventListener('focusout', () => setTimeout(check, 350));
  }

  _editableFocused() {
    const a = document.activeElement;
    return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName));
  }

  describe() {
    if (this.mode === 'on') return 'Vorschläge immer an';
    if (this.mode === 'off') return 'Vorschläge aus';
    if (this.isDesktop) return 'PC erkannt – Vorschläge aktiv';
    return this.detected ? 'Tastatur erkannt – Vorschläge aktiv' : 'Keine Tastatur erkannt – Vorschläge pausiert';
  }
}

export const keyboard = new KeyboardDetector();
