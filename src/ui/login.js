// Anmeldeseite: Google oder E-Mail. Ohne Konto geht es nicht weiter.
import { h, frag } from '../core/util.js';
import { icon } from '../core/icons.js';
import { auth, validEmail } from '../core/auth.js';

export function showLogin() {
  return new Promise((resolve) => {
    let mode = 'login'; // login | register
    const root = h('div', { class: 'auth-screen' });
    document.body.append(root);

    const render = () => {
      const msg = h('p', { class: 'auth-msg', role: 'alert' });
      const name = h('input', { class: 'input', placeholder: 'Name', autocomplete: 'name', name: 'name' });
      const email = h('input', { class: 'input', type: 'email', placeholder: 'E-Mail-Adresse', autocomplete: 'email', inputmode: 'email', name: 'email', required: true });
      const pw = h('input', { class: 'input', type: 'password', placeholder: 'Passwort', autocomplete: mode === 'login' ? 'current-password' : 'new-password', name: 'password', required: true });
      const pw2 = h('input', { class: 'input', type: 'password', placeholder: 'Passwort wiederholen', autocomplete: 'new-password' });
      const submit = h('button', { class: 'btn primary block', type: 'submit' }, mode === 'login' ? 'Anmelden' : 'Konto erstellen');
      const fail = (e) => { msg.textContent = e.message || String(e); submit.disabled = false; submit.textContent = mode === 'login' ? 'Anmelden' : 'Konto erstellen'; };
      const finish = () => { root.remove(); resolve(auth.session); };

      const form = h('form', { class: 'auth-form', onsubmit: async (e) => {
        e.preventDefault();
        msg.textContent = '';
        if (!validEmail(email.value.trim())) return fail(new Error('Bitte eine gültige E-Mail-Adresse angeben.'));
        if (mode === 'register') {
          if (pw.value.length < 8) return fail(new Error('Das Passwort braucht mindestens 8 Zeichen.'));
          if (pw.value !== pw2.value) return fail(new Error('Die Passwörter stimmen nicht überein.'));
        }
        submit.disabled = true; submit.textContent = 'Einen Moment …';
        try {
          if (mode === 'login') await auth.login({ email: email.value, password: pw.value });
          else await auth.register({ email: email.value, password: pw.value, name: name.value.trim() });
          finish();
        } catch (err) { fail(err); }
      } },
      mode === 'register' ? name : null, email, pw, mode === 'register' ? pw2 : null, msg, submit);

      // Google
      const googleSlot = h('div', { class: 'google-slot' });
      if (auth.googleClientId) {
        googleSlot.append(h('div', { class: 'google-loading' }, frag(icon.google), 'Google wird geladen …'));
        auth.loadGoogle().then((google) => {
          google.accounts.id.initialize({
            client_id: auth.googleClientId,
            callback: async ({ credential }) => { try { await auth.google(credential); finish(); } catch (err) { fail(err); } },
            ux_mode: 'popup',
            auto_select: false,
            itp_support: true,
          });
          googleSlot.replaceChildren();
          google.accounts.id.renderButton(googleSlot, { theme: 'filled_black', size: 'large', shape: 'pill', text: mode === 'login' ? 'signin_with' : 'signup_with', locale: 'de', width: Math.min(360, googleSlot.clientWidth || 320), logo_alignment: 'center' });
        }).catch((err) => { googleSlot.replaceChildren(googleFallback(err.message)); });
      } else {
        googleSlot.append(googleFallback('Die Google-Anmeldung ist hier noch nicht eingerichtet. Der Betreiber muss eine Google-Client-ID in luna.config.json (googleClientId) bzw. GOOGLE_CLIENT_ID hinterlegen. Bis dahin: mit E-Mail anmelden.'));
      }
      function googleFallback(text) {
        return h('button', { class: 'btn block google-btn', type: 'button', onclick: () => { msg.textContent = text; } }, frag(icon.google), mode === 'login' ? 'Mit Google anmelden' : 'Mit Google registrieren');
      }

      const server = auth.server;
      root.replaceChildren(h('div', { class: 'auth-card' },
        h('div', { class: 'auth-brand' }, h('img', { src: 'icons/icon-192.png', alt: 'Luna', width: 64, height: 64 })),
        h('h1', {}, mode === 'login' ? 'Bei Luna anmelden' : 'Luna-Konto erstellen'),
        h('p', { class: 'auth-sub' }, 'Ein Konto für PC, Handy und Tablet – deine Projekte sind überall dabei.'),
        googleSlot,
        h('div', { class: 'auth-divider' }, h('span', {}, 'oder mit E-Mail')),
        form,
        h('p', { class: 'auth-switch' }, mode === 'login' ? 'Noch kein Konto? ' : 'Schon ein Konto? ',
          h('button', { class: 'link-btn', type: 'button', onclick: () => { mode = mode === 'login' ? 'register' : 'login'; render(); } }, mode === 'login' ? 'Jetzt registrieren' : 'Anmelden')),
        h('div', { class: 'auth-mode ' + (server ? 'online' : 'local') },
          h('span', { class: 'dot' }),
          h('span', {}, server ? 'Mit Luna-Server verbunden – Projekte werden zwischen deinen Geräten synchronisiert.' : 'Kein Luna-Server erreichbar – das Konto gilt nur auf diesem Gerät.'),
          h('button', { class: 'link-btn', type: 'button', onclick: async () => {
            const url = prompt('Adresse des Luna-Servers (leer = diese Seite):', auth.serverBase());
            if (url === null) return;
            auth.setServerBase(url.trim());
            await auth.detectServer();
            render();
          } }, 'Server ändern')),
      ));
      setTimeout(() => (mode === 'register' ? name : email).focus(), 60);
    };
    render();
  });
}
