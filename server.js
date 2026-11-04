#!/usr/bin/env node
// Luna-Server ohne Abhängigkeiten (Node ≥ 18):
//  • liefert die App als statische Dateien aus
//  • /api/…   Konten (E-Mail + Passwort oder Google) und Synchronisierung zwischen PC, Handy, Tablet
//  • /collab  WebSocket-Relay für Live-Sessions
//
// Start:  node server.js                          (Port 8080, Daten in ./data)
//         PORT=3000 LUNA_DATA=/var/luna GOOGLE_CLIENT_ID=… node server.js
import { createServer } from 'node:http';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DATA = process.env.LUNA_DATA || join(ROOT, 'data');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || readConfig().googleClientId || '';
const MAX_MESSAGE = 16 * 1024 * 1024;
const MAX_BODY = 25 * 1024 * 1024;
const MAX_FILE = 2 * 1024 * 1024;

function readConfig() {
  try { return JSON.parse(readFileSync(join(ROOT, 'luna.config.json'), 'utf8')); } catch { return {}; }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
const BLOCKED = /^\/(node_modules|\.git|scripts|data)(\/|$)/;

// ---------- Speicher ----------
const store = { users: null, sessions: null, ws: new Map(), timers: new Map() };

async function loadJson(name, fallback) {
  try { return JSON.parse(await readFile(join(DATA, name), 'utf8')); } catch { return fallback; }
}
function persist(name, getData) {
  clearTimeout(store.timers.get(name));
  store.timers.set(name, setTimeout(async () => {
    const file = join(DATA, name);
    await mkdir(join(file, '..'), { recursive: true });
    const tmp = file + '.tmp';
    await writeFile(tmp, JSON.stringify(getData()));
    await rename(tmp, file);
  }, 300));
}
async function users() {
  if (!store.users) store.users = await loadJson('users.json', { byId: {}, byEmail: {} });
  return store.users;
}
async function sessions() {
  if (!store.sessions) store.sessions = await loadJson('sessions.json', {});
  return store.sessions;
}
async function workspace(userId) {
  if (!store.ws.has(userId)) store.ws.set(userId, await loadJson(`ws/${userId}.json`, { rev: 0, projects: {}, files: {}, meta: null }));
  return store.ws.get(userId);
}

// ---------- Konten ----------
const sha = (s) => createHash('sha256').update(s).digest('hex');
const hashPassword = (pw, salt) => scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200;
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, picture: u.picture || null, providers: u.providers });

async function createSession(user) {
  const token = randomBytes(32).toString('base64url');
  const s = await sessions();
  s[sha(token)] = { userId: user.id, created: Date.now() };
  persist('sessions.json', () => store.sessions);
  return token;
}

async function userFromRequest(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const s = (await sessions())[sha(m[1])];
  if (!s) return null;
  return (await users()).byId[s.userId] || null;
}

async function findOrCreate(email, data) {
  const u = await users();
  const key = email.toLowerCase();
  let user = u.byId[u.byEmail[key]];
  if (!user) {
    user = { id: randomBytes(9).toString('base64url'), email: key, name: data.name || key.split('@')[0], providers: [], created: Date.now() };
    u.byId[user.id] = user;
    u.byEmail[key] = user.id;
  }
  return user;
}

// Einfache Begrenzung gegen Passwort-Raten
const attempts = new Map();
function limited(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { n: 0, reset: now + 10 * 60 * 1000 };
  if (now > a.reset) { a.n = 0; a.reset = now + 10 * 60 * 1000; }
  a.n++;
  attempts.set(ip, a);
  return a.n > 30;
}

async function verifyGoogle(credential) {
  if (!GOOGLE_CLIENT_ID) throw httpError(400, 'Google-Anmeldung ist auf diesem Server nicht eingerichtet (GOOGLE_CLIENT_ID fehlt).');
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!res.ok) throw httpError(401, 'Google-Anmeldung ungültig.');
  const info = await res.json();
  if (info.aud !== GOOGLE_CLIENT_ID) throw httpError(401, 'Google-Anmeldung gehört zu einer anderen App.');
  if (info.email_verified !== 'true' && info.email_verified !== true) throw httpError(401, 'Die Google-E-Mail-Adresse ist nicht bestätigt.');
  if (Number(info.exp) * 1000 < Date.now()) throw httpError(401, 'Google-Anmeldung ist abgelaufen.');
  return info;
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

// ---------- API ----------
const routes = {
  'GET /api/config': async () => ({ google: GOOGLE_CLIENT_ID ? { clientId: GOOGLE_CLIENT_ID } : null, sync: true, version: 1 }),

  'POST /api/auth/register': async (req, body) => {
    const { email, password, name } = body;
    if (!validEmail(email)) throw httpError(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
    if (typeof password !== 'string' || password.length < 8) throw httpError(400, 'Das Passwort braucht mindestens 8 Zeichen.');
    const u = await users();
    const existing = u.byId[u.byEmail[email.toLowerCase()]];
    if (existing?.passHash) throw httpError(409, 'Zu dieser E-Mail gibt es schon ein Konto – bitte anmelden.');
    const user = await findOrCreate(email, { name });
    if (name) user.name = String(name).slice(0, 80);
    user.salt = randomBytes(16).toString('hex');
    user.passHash = hashPassword(password, user.salt);
    if (!user.providers.includes('password')) user.providers.push('password');
    persist('users.json', () => store.users);
    return { token: await createSession(user), user: publicUser(user) };
  },

  'POST /api/auth/login': async (req, body) => {
    const { email, password } = body;
    const u = await users();
    const user = validEmail(email) ? u.byId[u.byEmail[email.toLowerCase()]] : null;
    if (!user || !user.passHash) throw httpError(401, user ? 'Dieses Konto nutzt die Google-Anmeldung.' : 'E-Mail oder Passwort ist falsch.');
    const ok = timingSafeEqual(Buffer.from(hashPassword(String(password || ''), user.salt), 'hex'), Buffer.from(user.passHash, 'hex'));
    if (!ok) throw httpError(401, 'E-Mail oder Passwort ist falsch.');
    return { token: await createSession(user), user: publicUser(user) };
  },

  'POST /api/auth/google': async (req, body) => {
    const info = await verifyGoogle(String(body.credential || ''));
    const user = await findOrCreate(info.email, { name: info.name });
    if (!user.providers.includes('google')) user.providers.push('google');
    user.picture = info.picture || user.picture;
    if (info.name && !user.passHash) user.name = info.name;
    persist('users.json', () => store.users);
    return { token: await createSession(user), user: publicUser(user) };
  },

  'POST /api/auth/logout': async (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (m) { delete (await sessions())[sha(m[1])]; persist('sessions.json', () => store.sessions); }
    return { ok: true };
  },

  'GET /api/me': async (req, body, user) => ({ user: publicUser(user) }),

  'POST /api/me': async (req, body, user) => {
    if (typeof body.name === 'string' && body.name.trim()) user.name = body.name.trim().slice(0, 80);
    persist('users.json', () => store.users);
    return { user: publicUser(user) };
  },

  // Synchronisierung: Änderungen hochladen, alles seit „since“ zurückbekommen. Neuere Änderung (mtime) gewinnt.
  'POST /api/sync': async (req, body, user) => {
    const ws = await workspace(user.id);
    const since = Number(body.since) || 0;
    for (const p of Array.isArray(body.projects) ? body.projects : []) {
      if (!p || typeof p.id !== 'string') continue;
      const cur = ws.projects[p.id];
      if (!cur || (p.mtime || 0) >= (cur.mtime || 0)) ws.projects[p.id] = { id: p.id, meta: p.deleted ? null : p.meta, deleted: !!p.deleted, mtime: p.mtime || Date.now(), rev: ++ws.rev };
    }
    for (const f of Array.isArray(body.files) ? body.files : []) {
      if (!f || typeof f.scope !== 'string' || typeof f.path !== 'string') continue;
      if (typeof f.content === 'string' && f.content.length > MAX_FILE) continue;
      const key = f.scope + '\n' + f.path;
      const cur = ws.files[key];
      if (!cur || (f.mtime || 0) >= (cur.mtime || 0)) {
        ws.files[key] = { scope: f.scope, path: f.path, content: f.deleted ? null : (f.content ?? null), placeholder: !!f.placeholder, deleted: !!f.deleted, mtime: f.mtime || Date.now(), rev: ++ws.rev };
      }
    }
    if (body.meta && typeof body.meta === 'object' && (!ws.meta || (body.meta.mtime || 0) >= (ws.meta.mtime || 0))) {
      ws.meta = { data: body.meta.data, mtime: body.meta.mtime || Date.now(), rev: ++ws.rev };
    }
    persist(`ws/${user.id}.json`, () => ws);
    return {
      rev: ws.rev,
      projects: Object.values(ws.projects).filter((p) => p.rev > since),
      files: Object.values(ws.files).filter((f) => f.rev > since),
      meta: ws.meta && ws.meta.rev > since ? ws.meta : null,
    };
  },
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw httpError(413, 'Zu viele Daten auf einmal.');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError(400, 'Ungültiges JSON.'); }
}

async function handleApi(req, res, path) {
  const cors = {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const send = (status, data) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const route = routes[`${req.method} ${path}`];
  if (!route) return send(404, { error: 'Unbekannte API-Route.' });
  try {
    const ip = req.socket.remoteAddress || '';
    if (path.startsWith('/api/auth/') && path !== '/api/auth/logout' && limited(ip)) throw httpError(429, 'Zu viele Versuche – bitte in ein paar Minuten erneut.');
    const body = req.method === 'POST' ? await readBody(req) : {};
    let user = null;
    if (!path.startsWith('/api/auth/') && path !== '/api/config') {
      user = await userFromRequest(req);
      if (!user) throw httpError(401, 'Bitte neu anmelden.');
    }
    send(200, await route(req, body, user));
  } catch (e) {
    if (!e.status) console.error(e);
    send(e.status || 500, { error: e.status ? e.message : 'Serverfehler.' });
  }
}

// ---------- Statische Dateien ----------
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
    const apiAt = path.indexOf('/api/');
    if (apiAt >= 0) return handleApi(req, res, path.slice(apiAt));
    if (path.endsWith('/collab')) { res.writeHead(426, { 'Content-Type': 'text/plain' }); return res.end('WebSocket erwartet'); }
    if (path === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
    if (BLOCKED.test(path)) { res.writeHead(404); return res.end(); }
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let info = await stat(file).catch(() => null);
    let target = file;
    if (!info || info.isDirectory()) { target = join(ROOT, 'index.html'); info = await stat(target); }
    const ext = extname(target);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': ext === '.html' || target.endsWith('sw.js') || target.endsWith('.json') ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    res.end(await readFile(target));
  } catch (e) {
    res.writeHead(500); res.end('Fehler: ' + e.message);
  }
});

// ---------- WebSocket-Relay ----------
const rooms = new Map(); // room → Set(client)

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (!url.pathname.endsWith('/collab') || !key || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const room = (url.searchParams.get('room') || '').slice(0, 64);
  if (!/^[a-z0-9]{6,64}$/.test(room)) { socket.destroy(); return; }
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  const client = { socket, alive: true, buffer: Buffer.alloc(0), fragments: [], room };
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(client);

  socket.on('data', (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    try { parseFrames(client); } catch { close(client); }
  });
  socket.on('close', () => leave(client));
  socket.on('error', () => leave(client));
});

function parseFrames(c) {
  while (c.buffer.length >= 2) {
    const b0 = c.buffer[0], b1 = c.buffer[1];
    const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, offset = 2;
    if (len === 126) { if (c.buffer.length < 4) return; len = c.buffer.readUInt16BE(2); offset = 4; }
    else if (len === 127) { if (c.buffer.length < 10) return; len = Number(c.buffer.readBigUInt64BE(2)); offset = 10; }
    if (len > MAX_MESSAGE) throw new Error('zu groß');
    const maskLen = masked ? 4 : 0;
    if (c.buffer.length < offset + maskLen + len) return;
    const mask = masked ? c.buffer.subarray(offset, offset + 4) : null;
    const payload = Buffer.from(c.buffer.subarray(offset + maskLen, offset + maskLen + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    c.buffer = c.buffer.subarray(offset + maskLen + len);

    if (opcode === 0x8) { close(c); return; }
    if (opcode === 0x9) { send(c, payload, 0xa); continue; }
    if (opcode === 0xa) { c.alive = true; continue; }
    if (opcode === 0x0 || opcode === 0x1 || opcode === 0x2) {
      if (opcode !== 0x0) c.msgOpcode = opcode;
      c.fragments.push(payload);
      if (!fin) continue;
      const msg = Buffer.concat(c.fragments);
      c.fragments = [];
      if (c.msgOpcode === 0x2) broadcast(c, msg); // nur Binärnachrichten (Yjs)
    }
  }
}

function frame(payload, opcode = 0x2) {
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function send(c, payload, opcode = 0x2) {
  if (!c.socket.destroyed) c.socket.write(frame(payload, opcode));
}

function broadcast(from, msg) {
  const peers = rooms.get(from.room);
  if (!peers) return;
  const data = frame(msg);
  for (const c of peers) if (c !== from && !c.socket.destroyed) c.socket.write(data);
}

function close(c) {
  try { c.socket.write(frame(Buffer.alloc(0), 0x8)); } catch {}
  c.socket.end();
  leave(c);
}

function leave(c) {
  const set = rooms.get(c.room);
  if (!set) return;
  set.delete(c);
  if (!set.size) rooms.delete(c.room);
}

setInterval(() => {
  for (const set of rooms.values()) for (const c of set) {
    if (!c.alive) { c.socket.destroy(); leave(c); continue; }
    c.alive = false;
    send(c, Buffer.alloc(0), 0x9);
  }
}, 30000).unref();

server.listen(PORT, HOST, () => {
  console.log(`🌙 Luna läuft auf http://localhost:${PORT}`);
  console.log(`   Konten & Sync: /api · Live-Relay: /collab · Daten: ${DATA}`);
  console.log(`   Google-Anmeldung: ${GOOGLE_CLIENT_ID ? 'eingerichtet' : 'aus (GOOGLE_CLIENT_ID setzen)'}`);
  if (!existsSync(DATA)) console.log('   (Datenordner wird beim ersten Konto angelegt)');
});
