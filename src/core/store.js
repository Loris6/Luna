// Zentraler App-Zustand + Ereignisbus.
import { Emitter, uid } from './util.js';
import { kv } from './db.js';

export const COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#00a2c7'];

const defaults = {
  userName: '',
  userColor: COLORS[Math.floor(Math.random() * COLORS.length)],
  userId: uid(8),
  fontSize: 14,
  tabSize: 2,
  lineWrapping: false,
  completion: 'auto', // auto | on | off  – „auto“ = nur mit (Hardware-)Tastatur
  smartMode: true, // Blitz-Symbol: Vorschläge & Prüfungen
  collabServer: '', // leer = automatisch (gleicher Host, /collab)
  githubToken: '',
  sidebarWidth: 300,
  sidebarOpen: true,
  bottomOpen: false,
  rightOpen: false,
  bottomHeight: 220,
  rightWidth: 420,
  workspaceName: 'Mein Workspace',
};

class App extends Emitter {
  constructor() {
    super();
    this.settings = { ...defaults };
    this.notifications = [];
  }
  async init() {
    const saved = await kv.get('settings', {});
    this.settings = { ...defaults, ...saved };
    if (!saved.userId) this.saveSettings();
  }
  set(key, value) {
    if (this.settings[key] === value) return;
    this.settings[key] = value;
    this.saveSettings();
    this.emit('settings', { key, value });
  }
  saveSettings() { kv.set('settings', this.settings); }

  get user() {
    const s = this.settings;
    return { id: s.userId, name: s.userName || 'Gast', color: s.userColor, colorLight: s.userColor + '33' };
  }

  notify(text, { type = 'info', silent = false } = {}) {
    const n = { id: uid(6), text, type, ts: Date.now(), read: false };
    this.notifications.unshift(n);
    this.notifications.length = Math.min(this.notifications.length, 50);
    this.emit('notification', { ...n, silent });
    return n;
  }
}

export const app = new App();
