// Webhooks: eigene Ziele (z. B. Discord) mit API-Secret. Das Secret ist geschützt (Passwort / Face ID / Fingerabdruck).
import { kv } from './db.js';
import { app } from './store.js';
import { uid } from './util.js';
import { b64url } from './auth.js';
import { sync } from './sync.js';

export const newSecret = () => 'whsec_' + b64url(crypto.getRandomValues(new Uint8Array(24)));
export const isDiscordUrl = (u) => /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(u || '');

export async function listWebhooks() { return kv.get('webhooks', []); }

async function save(list) {
  await kv.set('webhooks', list);
  await kv.set('meta.mtime', Date.now());
  sync.markMeta();
  app.emit('webhooks-changed');
}

export async function createWebhook({ name, url, kind }) {
  const list = await listWebhooks();
  name = (name || '').trim();
  if (!name) throw new Error('Bitte einen Namen angeben.');
  if (list.some((w) => w.name.toLowerCase() === name.toLowerCase())) throw new Error(`Es gibt schon einen Webhook „${name}“.`);
  if (url && !/^https?:\/\//.test(url)) throw new Error('Die Ziel-Adresse muss mit https:// beginnen.');
  const hook = { id: uid(10), name, url: url || '', kind: kind || (isDiscordUrl(url) ? 'discord' : 'http'), secret: newSecret(), created: Date.now(), lastUsed: 0 };
  list.push(hook);
  await save(list);
  return hook;
}

export async function updateWebhook(id, patch) {
  const list = await listWebhooks();
  const w = list.find((x) => x.id === id);
  if (!w) return;
  Object.assign(w, patch);
  await save(list);
  return w;
}

export async function deleteWebhook(id) { await save((await listWebhooks()).filter((w) => w.id !== id)); }
export const regenerateSecret = (id) => updateWebhook(id, { secret: newSecret() });

async function hmac(secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sendet an das Ziel eines Webhooks. Discord bekommt {content}, andere Ziele JSON + Signatur-Header. */
export async function sendWebhook(hook, data) {
  if (!hook.url) throw new Error(`Webhook „${hook.name}“ hat keine Ziel-Adresse.`);
  const discord = hook.kind === 'discord' || isDiscordUrl(hook.url);
  const payload = discord ? { content: typeof data === 'string' ? data : JSON.stringify(data, null, 2).slice(0, 1900), username: 'Luna' } : { webhook: hook.name, data, sentAt: new Date().toISOString() };
  const body = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  if (!discord) headers['X-Luna-Signature'] = 'sha256=' + await hmac(hook.secret, body);
  const res = await fetch(hook.url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`Ziel antwortet mit ${res.status}.`);
  updateWebhook(hook.id, { lastUsed: Date.now() }).catch(() => {});
  return true;
}
