// Schutz: App-Sperre und Bestätigung für Webhook-Secrets – per Passwort oder geräteabhängig (Face ID, Touch ID, Fingerabdruck).
// Die Gerätesperre nutzt WebAuthn (Plattform-Authenticator mit Benutzer-Verifikation).
// Passwort vergessen? → richtige Konto-E-Mail eingeben → neues Passwort festlegen.
import { h, frag, setChildren } from './util.js';
import { icon } from './icons.js';
import { auth, pbkdf2, newSalt, b64url, fromB64url } from './auth.js';
import { biometricLabel, platform } from './platform.js';

const key = () => `luna.lock.${auth.user?.id || 'anon'}`;
const defaults = { password: null, device: null, lockApp: false, lockAfterMin: 5 };

export const secure = {
  get config() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(key())) }; } catch { return { ...defaults }; }
  },
  save(cfg) { try { localStorage.setItem(key(), JSON.stringify(cfg)); } catch {} },
  get hasProtection() { const c = this.config; return !!(c.password || c.device); },
  label: biometricLabel,

  async deviceAvailable() {
    try { return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())); }
    catch { return false; }
  },

  async setPassword(pw) {
    if (!pw || pw.length < 4) throw new Error('Das Passwort braucht mindestens 4 Zeichen.');
    const salt = newSalt();
    const c = this.config;
    c.password = { salt, hash: await pbkdf2(pw, salt) };
    this.save(c);
  },
  removePassword() { const c = this.config; c.password = null; if (!c.device) c.lockApp = false; this.save(c); },

  async setupDevice() {
    if (!(await this.deviceAvailable())) throw new Error(`${biometricLabel()} ist auf diesem Gerät/Browser nicht verfügbar.`);
    const u = auth.user;
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Luna' },
        user: { id: new TextEncoder().encode(u.id).slice(0, 64), name: u.email, displayName: u.name || u.email },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000,
        attestation: 'none',
      },
    });
    const c = this.config;
    c.device = { id: b64url(cred.rawId), label: biometricLabel(), created: Date.now() };
    this.save(c);
  },
  removeDevice() { const c = this.config; c.device = null; if (!c.password) c.lockApp = false; this.save(c); },

  async checkDevice() {
    const c = this.config;
    if (!c.device) return false;
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64url(c.device.id), transports: ['internal', 'hybrid'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    const flags = new Uint8Array(res.response.authenticatorData)[32];
    return (flags & 0x04) !== 0; // UV: Benutzer wurde per Biometrie/Gerätecode bestätigt
  },
  async checkPassword(pw) {
    const c = this.config;
    return !!c.password && (await pbkdf2(pw || '', c.password.salt)) === c.password.hash;
  },

  /**
   * Bestätigung abfragen. reason: Text; fullscreen: App-Sperre.
   * Gibt true zurück, wenn erfolgreich bestätigt.
   */
  verify({ reason = 'Bitte bestätigen', fullscreen = false } = {}) {
    return new Promise((resolve) => {
      const c = this.config;
      const msg = h('p', { class: 'lock-msg' });
      const done = (ok) => { root.remove(); document.removeEventListener('keydown', onKey, true); resolve(ok); };
      const onKey = (e) => { if (e.key === 'Escape' && !fullscreen) { e.stopPropagation(); done(false); } };
      document.addEventListener('keydown', onKey, true);
      const content = h('div', { class: 'lock-card' });
      const root = h('div', { class: 'lock-screen' + (fullscreen ? ' full' : ' modal') }, content);

      const main = () => {
        const pw = h('input', { class: 'input', type: 'password', placeholder: 'Passwort', autocomplete: 'current-password', enterkeyhint: 'go' });
        const tryPw = async () => {
          if (await this.checkPassword(pw.value)) return done(true);
          msg.textContent = 'Falsches Passwort.'; msg.className = 'lock-msg error';
          pw.select(); content.classList.remove('shake'); void content.offsetWidth; content.classList.add('shake');
        };
        pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryPw(); });
        const bio = c.device ? h('button', { class: 'btn primary block lock-bio', onclick: async () => {
          try { if (await this.checkDevice()) return done(true); msg.textContent = 'Nicht bestätigt.'; }
          catch (e) { msg.textContent = e.name === 'NotAllowedError' ? 'Abgebrochen.' : e.message; }
          msg.className = 'lock-msg error';
        } }, frag(platform.ios || platform.mac ? icon.faceId : icon.fingerprint), `Mit ${c.device.label} bestätigen`) : null;
        setChildren(content, 
          h('img', { class: 'lock-logo', src: 'icons/icon-192.png', alt: '' }),
          h('h2', {}, fullscreen ? 'Luna ist gesperrt' : 'Bestätigung erforderlich'),
          h('p', { class: 'lock-sub' }, fullscreen ? auth.user?.email || '' : reason),
          bio,
          c.password ? h('div', { class: 'lock-pw' }, pw, h('button', { class: 'btn primary', onclick: tryPw }, 'Entsperren')) : null,
          msg,
          c.password ? h('button', { class: 'link-btn', onclick: forgot }, 'Passwort vergessen?') : null,
          !fullscreen ? h('button', { class: 'link-btn muted', onclick: () => done(false) }, 'Abbrechen') : h('button', { class: 'link-btn muted', onclick: async () => { await auth.logout(); location.reload(); } }, 'Abmelden'),
        );
        if (c.password) setTimeout(() => (c.device ? null : pw.focus()), 50);
      };

      // Passwort vergessen: richtige E-Mail → neues Passwort
      const forgot = () => {
        const mail = h('input', { class: 'input', type: 'email', placeholder: 'E-Mail-Adresse deines Kontos', autocomplete: 'email', inputmode: 'email' });
        msg.textContent = ''; msg.className = 'lock-msg';
        setChildren(content, 
          h('h2', {}, 'Passwort zurücksetzen'),
          h('p', { class: 'lock-sub' }, 'Gib die E-Mail-Adresse deines Luna-Kontos ein. Stimmt sie, kannst du direkt ein neues Passwort festlegen.'),
          mail, msg,
          h('button', { class: 'btn primary block', onclick: () => {
            if (mail.value.trim().toLowerCase() !== (auth.user?.email || '').toLowerCase()) { msg.textContent = 'Diese E-Mail-Adresse gehört nicht zu diesem Konto.'; msg.className = 'lock-msg error'; return; }
            newPassword();
          } }, 'Weiter'),
          h('button', { class: 'link-btn muted', onclick: main }, 'Zurück'),
        );
        setTimeout(() => mail.focus(), 50);
      };
      const newPassword = () => {
        const a = h('input', { class: 'input', type: 'password', placeholder: 'Neues Passwort', autocomplete: 'new-password' });
        const b = h('input', { class: 'input', type: 'password', placeholder: 'Neues Passwort wiederholen', autocomplete: 'new-password' });
        msg.textContent = ''; msg.className = 'lock-msg';
        setChildren(content, 
          h('h2', {}, 'Neues Passwort'),
          h('p', { class: 'lock-sub' }, 'Mindestens 4 Zeichen.'),
          a, b, msg,
          h('button', { class: 'btn primary block', onclick: async () => {
            if (a.value !== b.value) { msg.textContent = 'Die Passwörter stimmen nicht überein.'; msg.className = 'lock-msg error'; return; }
            try { await this.setPassword(a.value); done(true); }
            catch (e) { msg.textContent = e.message; msg.className = 'lock-msg error'; }
          } }, 'Speichern & entsperren'),
        );
        setTimeout(() => a.focus(), 50);
      };

      main();
      document.body.append(root);
    });
  },

  /** Schutz einrichten (z. B. vor dem ersten Webhook-Secret). Gibt true zurück, wenn danach ein Schutz existiert. */
  setupDialog({ title = 'Schutz einrichten', text = 'Lege fest, wie du dich bestätigst, bevor geheime Daten angezeigt werden.' } = {}) {
    return new Promise(async (resolve) => {
      const devOk = await this.deviceAvailable();
      const msg = h('p', { class: 'lock-msg' });
      const a = h('input', { class: 'input', type: 'password', placeholder: 'Passwort', autocomplete: 'new-password' });
      const b = h('input', { class: 'input', type: 'password', placeholder: 'Passwort wiederholen', autocomplete: 'new-password' });
      const close = (ok) => { root.remove(); resolve(ok); };
      const content = h('div', { class: 'lock-card' },
        h('h2', {}, title),
        h('p', { class: 'lock-sub' }, text),
        devOk ? h('button', { class: 'btn primary block lock-bio', onclick: async () => {
          try { await this.setupDevice(); close(true); } catch (e) { msg.textContent = e.name === 'NotAllowedError' ? 'Abgebrochen.' : e.message; msg.className = 'lock-msg error'; }
        } }, frag(platform.ios || platform.mac ? icon.faceId : icon.fingerprint), `${biometricLabel()} verwenden`) : h('p', { class: 'lock-hint' }, `${biometricLabel()} ist hier nicht verfügbar – lege ein Passwort fest.`),
        devOk ? h('div', { class: 'lock-or' }, h('span', {}, 'oder Passwort')) : null,
        a, b, msg,
        h('button', { class: devOk ? 'btn block' : 'btn primary block', onclick: async () => {
          if (a.value !== b.value) { msg.textContent = 'Die Passwörter stimmen nicht überein.'; msg.className = 'lock-msg error'; return; }
          try { await this.setPassword(a.value); close(true); } catch (e) { msg.textContent = e.message; msg.className = 'lock-msg error'; }
        } }, 'Passwort speichern'),
        h('button', { class: 'link-btn muted', onclick: () => close(false) }, 'Abbrechen'),
      );
      const root = h('div', { class: 'lock-screen modal' }, content);
      document.body.append(root);
    });
  },

  /** Für geheime Daten: Schutz einrichten (falls noch keiner da ist) und bestätigen. */
  async confirmSecret(reason) {
    if (!this.hasProtection) {
      const ok = await this.setupDialog({ title: 'Secrets schützen', text: 'Bevor du API-Secrets einsehen kannst, lege ein Passwort oder die Gerätesperre fest. Du wirst dann bei jedem Anzeigen danach gefragt.' });
      return ok;
    }
    return this.verify({ reason });
  },

  /** App-Sperre beim Start und nach Inaktivität */
  initAppLock() {
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', async () => {
      const c = this.config;
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (!c.lockApp || !this.hasProtection || this.locked) return;
      if (c.lockAfterMin >= 0 && Date.now() - hiddenAt >= c.lockAfterMin * 60000) await this.lockNow();
    });
  },
  async lockNow() {
    if (this.locked) return;
    this.locked = true;
    while (!(await this.verify({ fullscreen: true })));
    this.locked = false;
  },
};
