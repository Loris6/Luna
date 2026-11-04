// Konto & Anmeldung. Ohne Konto mit E-Mail-Adresse lässt sich Luna nicht benutzen.
//
// • Mit Luna-Server (server.js): echtes Konto (E-Mail + Passwort oder Google) – Projekte werden zwischen
//   PC, Handy und Tablet synchronisiert.
// • Ohne Server (z. B. statisches Hosting): Konto nur auf diesem Gerät, Passwort lokal verschlüsselt (PBKDF2).
import { Emitter, uid } from './util.js';

const SESSION_KEY = 'luna.auth';
const LOCAL_ACCOUNTS = 'luna.localAccounts';
const SERVER_KEY = 'luna.serverUrl';

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export async function pbkdf2(password, saltB64, iterations = 150000) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(saltB64), iterations }, key, 256);
  return b64url(bits);
}
export const newSalt = () => b64url(crypto.getRandomValues(new Uint8Array(16)));
export { b64url, fromB64url };

export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || '');

class Auth extends Emitter {
  constructor() {
    super();
    this.session = null;
    this.config = {};
    this.server = null; // { google } wenn der Luna-Server erreichbar ist
  }

  async init() {
    this.config = await fetch('luna.config.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    try { this.session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { this.session = null; }
    await this.detectServer();
    if (this.session?.mode === 'server' && this.server) {
      try {
        const { user } = await this.api('/api/me');
        this.setSession({ ...this.session, user });
      } catch (e) {
        if (e.status === 401) this.clear();
      }
    }
    return this.session;
  }

  get user() { return this.session?.user || null; }
  get signedIn() { return !!this.session?.user?.email; }
  get serverMode() { return this.session?.mode === 'server'; }
  get googleClientId() { return this.server?.google?.clientId || this.config.googleClientId || ''; }

  serverBase() {
    let base = '';
    try { base = localStorage.getItem(SERVER_KEY) || ''; } catch {}
    return base || this.config.serverUrl || '';
  }
  setServerBase(url) {
    try { if (url) localStorage.setItem(SERVER_KEY, url.replace(/\/+$/, '')); else localStorage.removeItem(SERVER_KEY); } catch {}
  }
  apiUrl(path) {
    const base = this.serverBase();
    return base ? base.replace(/\/+$/, '') + path : new URL('.' + path, location.href).href;
  }

  async detectServer() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(this.apiUrl('/api/config'), { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      const data = res.ok && res.headers.get('content-type')?.includes('json') ? await res.json() : null;
      this.server = data && data.sync ? data : null;
    } catch { this.server = null; }
    this.emit('server', this.server);
    return this.server;
  }

  async api(path, body) {
    const res = await fetch(this.apiUrl(path), {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(this.session?.token ? { Authorization: 'Bearer ' + this.session.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Server antwortet mit ${res.status}`);
      err.status = res.status;
      if (res.status === 401 && this.session?.mode === 'server' && path !== '/api/auth/login') this.emit('expired');
      throw err;
    }
    return data;
  }

  setSession(s) {
    this.session = s;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
    this.emit('change', s);
  }
  clear() {
    this.session = null;
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    this.emit('change', null);
  }

  // ---------- Anmelden / Registrieren ----------
  async register({ email, password, name }) {
    email = (email || '').trim().toLowerCase();
    if (!validEmail(email)) throw new Error('Bitte eine gültige E-Mail-Adresse angeben.');
    if (!password || password.length < 8) throw new Error('Das Passwort braucht mindestens 8 Zeichen.');
    if (this.server) {
      const r = await this.api('/api/auth/register', { email, password, name });
      return this.setSession({ mode: 'server', token: r.token, user: r.user });
    }
    const accounts = this.localAccounts();
    if (accounts[email]?.hash) throw new Error('Zu dieser E-Mail gibt es auf diesem Gerät schon ein Konto – bitte anmelden.');
    const salt = newSalt();
    const id = accounts[email]?.id || 'l' + uid(10);
    accounts[email] = { id, name: name || email.split('@')[0], salt, hash: await pbkdf2(password, salt), providers: ['password'] };
    this.saveLocalAccounts(accounts);
    this.setSession({ mode: 'local', user: { id, email, name: accounts[email].name, providers: ['password'] } });
  }

  async login({ email, password }) {
    email = (email || '').trim().toLowerCase();
    if (!validEmail(email)) throw new Error('Bitte eine gültige E-Mail-Adresse angeben.');
    if (this.server) {
      const r = await this.api('/api/auth/login', { email, password });
      return this.setSession({ mode: 'server', token: r.token, user: r.user });
    }
    const acc = this.localAccounts()[email];
    if (!acc?.hash || (await pbkdf2(password || '', acc.salt)) !== acc.hash) throw new Error('E-Mail oder Passwort ist falsch.');
    this.setSession({ mode: 'local', user: { id: acc.id, email, name: acc.name, providers: acc.providers || ['password'] } });
  }

  /** Antwort von „Mit Google anmelden“ (Google Identity Services) */
  async google(credential) {
    if (this.server) {
      const r = await this.api('/api/auth/google', { credential });
      return this.setSession({ mode: 'server', token: r.token, user: r.user });
    }
    // Ohne Server: Angaben aus dem Google-Token übernehmen (Konto nur auf diesem Gerät)
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(credential.split('.')[1])));
    if (payload.aud !== this.googleClientId || payload.exp * 1000 < Date.now() || !payload.email_verified) throw new Error('Google-Anmeldung ungültig.');
    const email = payload.email.toLowerCase();
    const accounts = this.localAccounts();
    const acc = accounts[email] || { id: 'l' + uid(10), providers: [] };
    acc.name = payload.name || acc.name || email;
    acc.picture = payload.picture;
    if (!acc.providers.includes('google')) acc.providers.push('google');
    accounts[email] = acc;
    this.saveLocalAccounts(accounts);
    this.setSession({ mode: 'local', user: { id: acc.id, email, name: acc.name, picture: acc.picture, providers: acc.providers } });
  }

  async logout() {
    if (this.serverMode) await this.api('/api/auth/logout', {}).catch(() => {});
    this.clear();
  }

  async rename(name) {
    if (this.serverMode) {
      const { user } = await this.api('/api/me', { name });
      return this.setSession({ ...this.session, user });
    }
    const accounts = this.localAccounts();
    if (accounts[this.user.email]) { accounts[this.user.email].name = name; this.saveLocalAccounts(accounts); }
    this.setSession({ ...this.session, user: { ...this.user, name } });
  }

  localAccounts() { try { return JSON.parse(localStorage.getItem(LOCAL_ACCOUNTS)) || {}; } catch { return {}; } }
  saveLocalAccounts(a) { try { localStorage.setItem(LOCAL_ACCOUNTS, JSON.stringify(a)); } catch {} }

  // ---------- Google Identity Services ----------
  loadGoogle() {
    if (!this.googleClientId) return Promise.reject(new Error('Google-Anmeldung ist nicht eingerichtet.'));
    if (window.google?.accounts?.id) return Promise.resolve(window.google);
    if (!this._gsi) {
      this._gsi = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => resolve(window.google);
        s.onerror = () => { this._gsi = null; reject(new Error('Google konnte nicht geladen werden (offline?).')); };
        document.head.append(s);
      });
    }
    return this._gsi;
  }
}

export const auth = new Auth();
