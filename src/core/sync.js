// Synchronisierung über den Luna-Server: gleiche Projekte auf PC, Handy und Tablet.
// Lokale Änderungen werden gesammelt und gebündelt hochgeladen; Änderungen anderer Geräte kommen zurück.
// Bei Konflikten gewinnt die neuere Änderung (Zeitstempel).
import { Emitter, debounce } from './util.js';
import { auth } from './auth.js';
import { kv } from './db.js';
import { app } from './store.js';
import { hooks, getProject, getFiles, cleanProject, readRecord, applyRemoteProject, applyRemoteFile, state as P } from '../projects/projects.js';

const MAX_FILE = 2 * 1024 * 1024;

class Sync extends Emitter {
  constructor() {
    super();
    this.status = 'idle'; // idle | syncing | ok | offline | error | local
    this.lastSync = 0;
    this.error = '';
    this.pending = { files: new Map(), projects: new Map(), meta: false };
  }

  get enabled() { return auth.serverMode && !!auth.server; }

  async init() {
    const saved = await kv.get('sync.pending', null);
    if (saved) {
      for (const [k, v] of saved.files || []) this.pending.files.set(k, v);
      for (const [k, v] of saved.projects || []) this.pending.projects.set(k, v);
      this.pending.meta = !!saved.meta;
    }
    this.rev = await kv.get('sync.rev', 0);
    this.lastSync = await kv.get('sync.last', 0);
    hooks.file = (scope, path, deleted) => {
      const id = scope.split('@')[0];
      if (getProject(id)?.source === 'live') return;
      this.pending.files.set(scope + '\n' + path, { scope, path, deleted, mtime: Date.now() });
      this.queue();
    };
    hooks.project = (id, deleted) => {
      if (getProject(id)?.source === 'live') return;
      this.pending.projects.set(id, { deleted: !!deleted, mtime: Date.now() });
      this.queue();
    };
    app.on('account-meta-changed', () => { kv.set('meta.mtime', Date.now()); this.markMeta(); });
    if (!this.enabled) { this.setStatus('local'); return; }
    // Bisherige Projekte beim allerersten Sync dieses Geräts mitschicken
    if (!this.rev) {
      for (const p of P.list) {
        if (p.source === 'live') continue;
        this.pending.projects.set(p.id, { mtime: p.mtime || Date.now() });
        for (const b of Object.keys(p.branches || { [p.branch]: 1 })) {
          const files = await getFiles(p, b).catch(() => null);
          for (const r of files?.values() || []) if (r.content != null) this.pending.files.set(r.scope + '\n' + r.path, { scope: r.scope, path: r.path, mtime: r.mtime || 1 });
        }
      }
    }
    addEventListener('online', () => this.now());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.now(); });
    setInterval(() => { if (!document.hidden) this.now(); }, 30000);
    this.now();
  }

  markMeta() { this.pending.meta = true; this.queue(); }

  queue = debounce(() => { this.savePending(); this.now(); }, 1500);

  savePending() {
    kv.set('sync.pending', { files: [...this.pending.files], projects: [...this.pending.projects], meta: this.pending.meta });
  }

  setStatus(s, error = '') { this.status = s; this.error = error; this.emit('status', s); app.emit('sync-status', s); }

  async now() {
    if (!this.enabled || this.running) return;
    if (!navigator.onLine) return this.setStatus('offline');
    this.running = true;
    this.setStatus('syncing');
    const files = new Map(this.pending.files);
    const projects = new Map(this.pending.projects);
    const meta = this.pending.meta;
    this.pending.files.clear(); this.pending.projects.clear(); this.pending.meta = false;
    try {
      const body = { since: this.rev || 0, projects: [], files: [], meta: null };
      for (const [id, info] of projects) {
        const p = getProject(id);
        if (info.deleted || !p) body.projects.push({ id, deleted: true, mtime: info.mtime });
        else body.projects.push({ id, meta: cleanProject(p), mtime: p.mtime || info.mtime });
      }
      for (const info of files.values()) {
        if (info.deleted) { body.files.push({ scope: info.scope, path: info.path, deleted: true, mtime: info.mtime }); continue; }
        const rec = await readRecord(info.scope, info.path);
        if (!rec || rec.binary || rec.content == null || rec.content.length > MAX_FILE) continue;
        body.files.push({ scope: info.scope, path: info.path, content: rec.content, placeholder: !!rec.placeholder, mtime: rec.mtime || info.mtime });
      }
      if (meta) body.meta = { data: await this.collectMeta(), mtime: Date.now() };
      const res = await auth.api('/api/sync', body);
      // Erst Projekte, dann Dateien übernehmen
      for (const r of res.projects || []) if (!this.pending.projects.has(r.id)) await applyRemoteProject(r);
      for (const f of res.files || []) if (!this.pending.files.has(f.scope + '\n' + f.path)) await applyRemoteFile(f);
      if (res.meta && !this.pending.meta) await this.applyMeta(res.meta);
      this.rev = res.rev;
      this.lastSync = Date.now();
      kv.set('sync.rev', this.rev);
      kv.set('sync.last', this.lastSync);
      this.savePending();
      this.setStatus('ok');
    } catch (e) {
      // nicht verlieren: zurück in die Warteschlange
      for (const [k, v] of files) if (!this.pending.files.has(k)) this.pending.files.set(k, v);
      for (const [k, v] of projects) if (!this.pending.projects.has(k)) this.pending.projects.set(k, v);
      if (meta) this.pending.meta = true;
      this.savePending();
      this.setStatus(navigator.onLine ? 'error' : 'offline', e.message);
    } finally {
      this.running = false;
      if (this.pending.files.size || this.pending.projects.size || this.pending.meta) this.queue();
    }
  }

  // Konto-Daten (Webhooks, Verbindungen) – letzte Änderung gewinnt
  async collectMeta() { return { webhooks: await kv.get('webhooks', []), connections: await kv.get('connections', {}), githubToken: app.settings.githubToken || '' }; }
  async applyMeta(m) {
    const local = await kv.get('meta.mtime', 0);
    if ((m.mtime || 0) <= local) return;
    if (m.data?.webhooks) await kv.set('webhooks', m.data.webhooks);
    if (m.data?.connections) await kv.set('connections', m.data.connections);
    if (typeof m.data?.githubToken === 'string' && m.data.githubToken !== app.settings.githubToken) { app.settings.githubToken = m.data.githubToken; app.saveSettings(); }
    await kv.set('meta.mtime', m.mtime);
    app.emit('webhooks-changed');
  }

  describe() {
    if (!auth.serverMode) return 'Nur auf diesem Gerät';
    if (!auth.server) return 'Server nicht erreichbar';
    switch (this.status) {
      case 'syncing': return 'Synchronisiere …';
      case 'offline': return 'Offline – wird später synchronisiert';
      case 'error': return 'Synchronisierung fehlgeschlagen';
      case 'ok': return 'Synchronisiert';
      default: return 'Bereit';
    }
  }
}

export const sync = new Sync();
