// Live-Zusammenarbeit (Bild 2): mehrere Personen bearbeiten dieselben Dateien gleichzeitig.
// Technik: Yjs (CRDT) für konfliktfreies Zusammenführen, Awareness für Cursor/Namen.
// Transport: BroadcastChannel (Tabs/Fenster auf diesem Gerät) + WebSocket-Relay (server.js) für andere Geräte.
import { Y, awarenessProtocol, syncProtocol, encoding, decoding } from '../../vendor/core.js';
import { db } from '../core/db.js';
import { app } from '../core/store.js';
import { auth } from '../core/auth.js';
import { Emitter, uid, debounce } from '../core/util.js';
import {
  state as P, getFiles, writeFile, createFile, deletePath, createProject, saveProject, getProject,
} from '../projects/projects.js';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_QUERY_AWARENESS = 3;
const SEED_LIMIT = 512 * 1024;

export const sessions = new Map(); // projectId → LiveSession

export function collabServerUrl() {
  const custom = (app.settings.collabServer || '').trim();
  if (custom) return custom.replace(/^http/, 'ws');
  const base = auth.serverBase();
  const u = new URL(base ? base.replace(/\/+$/, '') + '/collab' : 'collab', location.href);
  u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = ''; u.hash = '';
  return u.href;
}

export const shareLink = (room) => {
  const u = new URL(location.href);
  u.search = ''; u.hash = 'live=' + room;
  return u.href;
};

class LiveSession extends Emitter {
  constructor(project, room, role) {
    super();
    this.project = project;
    this.room = room;
    this.role = role; // 'host' | 'guest'
    this.doc = new Y.Doc();
    this.files = this.doc.getMap('files');
    this.meta = this.doc.getMap('meta');
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.synced = false;
    this.wsStatus = 'connecting';
    this.knownPeers = new Set();
    this.pendingWrites = new Set();
    this.destroyed = false;
  }

  get status() {
    if (this.wsStatus === 'online') return 'online';
    if (this.wsStatus === 'connecting') return 'connecting';
    return 'local';
  }

  async start() {
    // 1) Gespeicherten Stand laden (überlebt Neuladen/Offline)
    const saved = await db.get('ystate', this.room).catch(() => null);
    if (saved?.update) Y.applyUpdate(this.doc, saved.update, 'persist');
    this.persist = debounce(() => db.put('ystate', { room: this.room, projectId: this.project.id, update: Y.encodeStateAsUpdate(this.doc) }).catch(() => {}), 600);

    // 2) Host füllt beim allerersten Start die Dateien ein
    if (this.role === 'host' && !this.meta.get('createdAt')) {
      const files = await getFiles(this.project);
      this.doc.transact(() => {
        for (const rec of files.values()) {
          if (rec.placeholder || rec.content == null || rec.size > SEED_LIMIT) continue;
          this.files.set(rec.path, new Y.Text(rec.content));
        }
        this.meta.set('name', this.project.name);
        this.meta.set('host', app.user.name);
        this.meta.set('createdAt', Date.now());
      }, 'seed');
      this.synced = true;
    } else if (saved?.update || this.role === 'host') this.synced = true;

    this.doc.on('update', (update, origin) => {
      this.persist();
      if (origin !== this) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.writeUpdate(enc, update);
        this.send(encoding.toUint8Array(enc));
      }
    });
    this.files.observeDeep((events, tr) => this.mirror(events, tr));
    this.meta.observe(() => this.onMeta());

    this.awareness.setLocalState({ user: app.user, file: null });
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      if (origin === 'local') this.send(this.awarenessMessage(changed));
      for (const id of added) {
        if (id !== this.doc.clientID && !this.knownPeers.has(id)) { this.knownPeers.add(id); this.sendStep1(); }
      }
    });
    this.awareness.on('change', ({ added, removed }, origin) => {
      if (origin !== 'local') {
        for (const id of added) { const u = this.awareness.getStates().get(id)?.user; if (u) app.notify(`${u.name} ist der Live-Session beigetreten.`); }
        for (const id of removed) this.knownPeers.delete(id);
      }
      this.emit('peers', this.peers());
    });
    this.userSub = app.on('settings', ({ key }) => { if (key === 'userName' || key === 'userColor') this.awareness.setLocalStateField('user', app.user); });

    // 3) Verbinden
    this.bc = new BroadcastChannel('luna-live-' + this.room);
    this.bc.onmessage = (e) => this.receive(new Uint8Array(e.data));
    this.connectWs();
    this.sendHello();
    this.onUnload = () => { awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'unload'); };
    addEventListener('pagehide', this.onUnload);
    this.onMeta();
    return this;
  }

  // ---------- Transport ----------
  connectWs() {
    if (this.destroyed) return;
    let ws;
    try { ws = new WebSocket(collabServerUrl() + (collabServerUrl().includes('?') ? '&' : '?') + 'room=' + encodeURIComponent(this.room)); }
    catch { this.setWs('local'); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    let opened = false;
    ws.onopen = () => { opened = true; this.retry = 0; this.setWs('online'); this.sendHello(); };
    ws.onmessage = (e) => this.receive(new Uint8Array(e.data));
    ws.onclose = () => {
      this.ws = null;
      if (this.destroyed) return;
      this.setWs(opened ? 'connecting' : 'local');
      this.retry = Math.min((this.retry || 0) + 1, 6);
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.connectWs(), 1000 * 2 ** this.retry);
    };
    ws.onerror = () => {};
  }
  setWs(s) { if (this.wsStatus !== s) { this.wsStatus = s; this.emit('status', this.status); } }

  send(buf) {
    if (this.destroyed) return;
    try { this.bc?.postMessage(buf); } catch {}
    if (this.ws?.readyState === 1) this.ws.send(buf);
  }

  sendStep1() {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.send(encoding.toUint8Array(enc));
  }
  sendHello() {
    this.sendStep1();
    this.send(this.awarenessMessage([this.doc.clientID]));
    const q = encoding.createEncoder(); encoding.writeVarUint(q, MSG_QUERY_AWARENESS);
    this.send(encoding.toUint8Array(q));
  }
  awarenessMessage(clients) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients));
    return encoding.toUint8Array(enc);
  }

  receive(data) {
    if (this.destroyed) return;
    try {
      const dec = decoding.createDecoder(data);
      const type = decoding.readVarUint(dec);
      if (type === MSG_SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        const t = syncProtocol.readSyncMessage(dec, enc, this.doc, this);
        if (encoding.length(enc) > 1) this.send(encoding.toUint8Array(enc));
        if ((t === syncProtocol.messageYjsSyncStep2 || t === syncProtocol.messageYjsUpdate) && !this.synced && this.files.size) {
          this.synced = true; this.emit('synced');
        }
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), this);
      } else if (type === MSG_QUERY_AWARENESS) {
        this.send(this.awarenessMessage([this.doc.clientID]));
      }
    } catch (e) { console.warn('Live: Nachricht verworfen', e); }
  }

  // ---------- Y → Projektspeicher ----------
  mirror(events, tr) {
    if (tr.origin !== this && tr.origin !== 'persist') return; // lokale Änderungen sind schon gespeichert
    for (const ev of events) {
      if (ev.target === this.files) {
        ev.changes.keys.forEach((change, key) => {
          if (change.action === 'delete') deletePath(this.project, key, { origin: 'live' });
          else this.pendingWrites.add(key);
        });
      } else if (ev.path.length) this.pendingWrites.add(ev.path[0]);
    }
    this.flushWrites();
  }

  async flushWrites() {
    const files = await getFiles(this.project);
    for (const path of [...this.pendingWrites]) {
      this.pendingWrites.delete(path);
      const t = this.files.get(path);
      if (!(t instanceof Y.Text)) continue;
      const text = t.toString();
      if (files.has(path)) writeFile(this.project, path, text, { origin: 'live' });
      else await createFile(this.project, path, text, { origin: 'live' }).catch(() => {});
    }
  }

  onMeta() {
    const name = this.meta.get('name');
    if (this.role === 'guest' && name && this.project.name !== `${name} (Live)`) {
      this.project.name = `${name} (Live)`;
      saveProject(this.project);
      app.emit('projects-changed');
    }
    if (this.meta.get('ended') && this.role === 'guest') {
      app.notify('Der Host hat die Live-Session beendet. Deine Kopie bleibt erhalten.');
      endLocal(this.project, false);
    }
  }

  // ---------- Projektspeicher → Y (lokale Datei-Operationen) ----------
  onLocalWrite(path, content, origin) {
    if (origin === 'editor-collab') return;
    const t = this.files.get(path);
    if (!(t instanceof Y.Text)) { if (this.role === 'host') this.doc.transact(() => this.files.set(path, new Y.Text(content)), 'local'); return; }
    const old = t.toString();
    if (old === content) return;
    let a = 0; while (a < old.length && a < content.length && old[a] === content[a]) a++;
    let b = 0; while (b < old.length - a && b < content.length - a && old[old.length - 1 - b] === content[content.length - 1 - b]) b++;
    this.doc.transact(() => { t.delete(a, old.length - a - b); t.insert(a, content.slice(a, content.length - b)); }, 'local');
  }
  onLocalCreate(path, content) { if (!this.files.has(path)) this.doc.transact(() => this.files.set(path, new Y.Text(content)), 'local'); }
  onLocalDelete(path) { if (this.files.has(path)) this.doc.transact(() => this.files.delete(path), 'local'); }
  onLocalRename(from, to, content) {
    this.doc.transact(() => {
      const t = this.files.get(from);
      const text = t instanceof Y.Text ? t.toString() : content;
      this.files.delete(from);
      this.files.set(to, new Y.Text(text));
    }, 'local');
  }

  /** Y.Text für den Editor. Host legt fehlende Texte an (z. B. erst später geladene Dateien). */
  textFor(path, content) {
    let t = this.files.get(path);
    if (t instanceof Y.Text) return t;
    if (this.role === 'host' || (this.synced && content != null)) {
      t = new Y.Text(content ?? '');
      this.doc.transact(() => this.files.set(path, t), 'local');
      return this.files.get(path);
    }
    return null;
  }

  setActiveFile(path) {
    const cur = this.awareness.getLocalState();
    if (cur?.file !== path) this.awareness.setLocalStateField('file', path);
  }

  peers() {
    const out = [];
    this.awareness.getStates().forEach((s, id) => {
      if (id === this.doc.clientID || !s.user) return;
      out.push({ clientId: id, user: s.user, file: s.file, cursor: s.cursor });
    });
    return out;
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.retryTimer);
    try { awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'leave'); } catch {}
    this.persist?.flush?.();
    this.bc?.close();
    this.ws?.close();
    this.userSub?.();
    removeEventListener('pagehide', this.onUnload);
    this.awareness.destroy();
    this.emit('destroyed');
  }
}

// ---------- Öffentliche API ----------
async function attach(project, room, role) {
  const s = new LiveSession(project, room, role);
  sessions.set(project.id, s);
  P.live.set(project.id, s);
  await s.start();
  app.emit('live-changed', project);
  s.on('status', () => app.emit('live-status', project));
  s.on('peers', () => app.emit('live-peers', project));
  return s;
}

export const getSession = (projectId) => sessions.get(projectId);

export async function startSession(project) {
  if (sessions.has(project.id)) return sessions.get(project.id);
  project.liveRoom = uid(12);
  project.liveRole = 'host';
  await saveProject(project);
  const s = await attach(project, project.liveRoom, 'host');
  app.notify(`Live-Session für „${project.name}“ gestartet.`);
  return s;
}

export async function joinSession(room) {
  room = room.trim().replace(/^.*live=/, '');
  if (!/^[a-z0-9]{6,32}$/.test(room)) throw new Error('Ungültiger Session-Code.');
  let project = P.list.find((p) => p.liveRoom === room);
  if (project && sessions.has(project.id)) return sessions.get(project.id);
  if (!project) {
    project = await createProject({ name: 'Live-Session', source: 'live', files: {}, branch: 'live', extra: { liveRoom: room, liveRole: 'guest' } });
  }
  const s = await attach(project, room, project.liveRole || 'guest');
  app.notify('Live-Session beigetreten – warte auf Dateien …', { silent: true });
  return s;
}

async function endLocal(project, notifyOthers) {
  const s = sessions.get(project.id);
  if (!s) return;
  if (notifyOthers) s.doc.transact(() => s.meta.set('ended', true), 'local');
  await new Promise((r) => setTimeout(r, notifyOthers ? 250 : 0));
  s.destroy();
  sessions.delete(project.id);
  P.live.delete(project.id);
  await db.del('ystate', s.room).catch(() => {});
  delete project.liveRoom; delete project.liveRole;
  if (project.source === 'live') project.source = 'local';
  await saveProject(project);
  app.emit('live-changed', project);
  app.emit('projects-changed');
}

export const stopSession = (project) => endLocal(project, project.liveRole === 'host');

/** Beim Start: offene Sessions wieder aufnehmen */
export async function resumeSessions() {
  for (const p of P.list) if (p.liveRoom && !sessions.has(p.id)) await attach(p, p.liveRoom, p.liveRole || 'guest').catch(console.error);
}

app.on('project-removed', (p) => { const s = sessions.get(p.id); if (s) { s.destroy(); sessions.delete(p.id); P.live.delete(p.id); } });

export { getProject };
