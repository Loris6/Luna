#!/usr/bin/env node
// Luna-Server ohne Abhängigkeiten:
//  • liefert die App als statische Dateien aus
//  • /collab = WebSocket-Relay für Live-Sessions (leitet Nachrichten an alle anderen im selben Raum weiter)
//
// Start:  node server.js            (Port 8080)
//         PORT=3000 node server.js
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_MESSAGE = 16 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
const BLOCKED = /^\/(node_modules|\.git|scripts)(\/|$)/;

// ---------- Statische Dateien ----------
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
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
      'Cache-Control': ext === '.html' || target.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300',
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

// Verbindungen ohne Lebenszeichen schließen
setInterval(() => {
  for (const set of rooms.values()) for (const c of set) {
    if (!c.alive) { c.socket.destroy(); leave(c); continue; }
    c.alive = false;
    send(c, Buffer.alloc(0), 0x9);
  }
}, 30000).unref();

server.listen(PORT, HOST, () => {
  console.log(`🌙 Luna läuft auf http://localhost:${PORT}  (Live-Relay: ws://localhost:${PORT}/collab)`);
});
