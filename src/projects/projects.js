// Projekte („Repos“), Branches und Dateien. Alles wird in IndexedDB gespeichert.
import { db, kv } from '../core/db.js';
import { app, COLORS } from '../core/store.js';
import { auth } from '../core/auth.js';
import { uid, basename, dirname, normalizePath, isBinaryPath, debounce } from '../core/util.js';
import { compileGitignore } from './gitignore.js';
import { TEMPLATES, DEMO_VERSION } from './templates.js';

export const state = {
  list: [], // Projekt-Metadaten
  files: new Map(), // scope → Map(path → Datensatz)
  live: new Map(), // projectId → LiveSession (gesetzt von collab/session.js)
  remote: new Map(), // source → { fetchContent(project, rec, signal) , sync(), … } (GitHub, Ordner)
};

export const scopeOf = (p, branch = p.branch) => `${p.id}@${branch}`;
export const getProject = (id) => state.list.find((p) => p.id === id);

const INDEX_LIMIT = 1024 * 1024; // > 1 MB wird nicht indiziert

// ---------- Laden & Speichern ----------
export async function loadProjects() {
  state.list = (await db.all('projects')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const version = (await kv.get('demoVersion')) || ((await kv.get('demoCreated')) ? 1 : 0);
  if (version < DEMO_VERSION) {
    // Altes, unverändertes Demo-Projekt (noch mit JavaScript usw.) durch das Luna-Demo ersetzen
    const old = state.list.find((p) => p.name === 'Luna Demo' && p.source === 'local' && !p.lunaDemo);
    if (old) {
      const files = await getFiles(old).catch(() => null);
      const untouched = files && [...files.values()].every((r) => r.placeholder || r.baseline === r.content);
      if (untouched) await removeProject(old); else { old.name = 'Altes Demo'; await saveProject(old); }
    }
    if (version === 0 || !state.list.some((p) => p.lunaDemo)) {
      // feste ID pro Konto → auf allen Geräten dasselbe Demo-Projekt (keine Duplikate beim Synchronisieren)
      const p = await createProject({ name: 'Luna Demo', template: 'demo', color: '#3e63dd', extra: { lunaDemo: true, id: 'demo-' + (auth.user?.id || 'local') }, seedMtime: 1 });
      state.list.splice(state.list.indexOf(p), 1);
      state.list.unshift(p);
      state.list.forEach((x, i) => { x.order = i; saveProject(x); });
    }
    kv.set('demoVersion', DEMO_VERSION);
    kv.set('openTabs', []);
  }
  return state.list;
}

/** Wird von der Synchronisierung gesetzt: meldet lokale Änderungen. */
export const hooks = { file: null, project: null };

export function cleanProject(p) {
  const clean = { ...p };
  for (const k of Object.keys(clean)) if (k.startsWith('_')) delete clean[k];
  return clean;
}

export function saveProject(p, { silent = false } = {}) {
  if (!silent) { p.mtime = Date.now(); hooks.project?.(p.id); }
  return db.put('projects', cleanProject(p));
}

export async function getFiles(p, branch = p.branch) {
  const scope = scopeOf(p, branch);
  if (!state.files.has(scope)) {
    const recs = await db.byIndex('files', 'scope', scope);
    const map = new Map();
    for (const r of recs) map.set(r.path, r);
    if (!state.files.has(scope)) state.files.set(scope, map);
  }
  return state.files.get(scope);
}
export const filesSync = (p, branch = p.branch) => state.files.get(scopeOf(p, branch));

// Gebündeltes Speichern (alle 400 ms)
const dirty = new Map(); // scope → Set(path)
const deleted = []; // [scope, path]
const flush = debounce(async () => {
  const puts = [];
  for (const [scope, paths] of dirty) {
    const map = state.files.get(scope);
    for (const path of paths) { const r = map?.get(path); if (r) puts.push(r); }
  }
  dirty.clear();
  const dels = deleted.splice(0);
  try {
    if (puts.length) await db.putMany('files', puts);
    for (const [scope, path] of dels) await db.del('files', [scope, path]);
  } catch (e) { console.error(e); app.notify('Speichern fehlgeschlagen: ' + e.message, { type: 'error' }); }
}, 400);
export const flushNow = () => flush.flush();
addEventListener('pagehide', () => flush.flush());
document.addEventListener('visibilitychange', () => { if (document.hidden) flush.flush(); });

function markDirty(scope, path, { silent = false } = {}) {
  if (!dirty.has(scope)) dirty.set(scope, new Set());
  dirty.get(scope).add(path);
  flush();
  if (!silent) hooks.file?.(scope, path, false);
}
function markDeleted(scope, path) {
  deleted.push([scope, path]);
  hooks.file?.(scope, path, true);
}

// ---------- Projekte ----------
export async function createProject({ name, template = 'empty', files, source = 'local', color, extra = {}, branch = 'main', seedMtime = null }) {
  const p = {
    id: uid(8), name, source, branch, defaultBranch: branch,
    branches: { [branch]: { status: 'synced', syncedAt: Date.now() } },
    display: 'all', collapsed: false, order: state.list.length,
    color: color || COLORS[state.list.length % COLORS.length],
    createdAt: Date.now(), ...extra,
  };
  state.list.push(p);
  await saveProject(p);
  const scope = scopeOf(p);
  const map = new Map();
  state.files.set(scope, map);
  const content = files || TEMPLATES[template]?.files || {};
  const recs = [];
  for (const [path, value] of Object.entries(content)) {
    const rec = makeRec(scope, path, value);
    if (seedMtime != null) rec.mtime = seedMtime; // Vorlagen-Inhalt: echte Änderungen anderer Geräte sind immer „neuer“
    map.set(rec.path, rec); recs.push(rec);
  }
  if (recs.length) await db.putMany('files', recs);
  for (const r of recs) hooks.file?.(scope, r.path, false);
  app.emit('projects-changed');
  return p;
}

function makeRec(scope, path, value) {
  path = normalizePath(path);
  if (value && typeof value === 'object' && !(value instanceof Blob)) {
    return { scope, path, ...value, size: value.size ?? (typeof value.content === 'string' ? value.content.length : value.blob?.size || 0), mtime: Date.now() };
  }
  if (value instanceof Blob) return { scope, path, content: null, blob: value, binary: true, size: value.size, mtime: Date.now() };
  return { scope, path, content: value, baseline: value, size: value.length, mtime: Date.now() };
}

export async function removeProject(p, { silent = false } = {}) {
  if (!silent) hooks.project?.(p.id, true);
  for (const b of Object.keys(p.branches || {})) await db.delByIndex('files', 'scope', scopeOf(p, b));
  await db.del('projects', p.id);
  state.list = state.list.filter((x) => x !== p);
  for (const k of [...state.files.keys()]) if (k.startsWith(p.id + '@')) state.files.delete(k);
  app.emit('projects-changed');
  app.emit('project-removed', p);
}

export function renameProject(p, name) {
  p.name = name; saveProject(p); app.emit('projects-changed');
}

export function updateProject(p, patch) {
  Object.assign(p, patch); saveProject(p); app.emit('projects-changed'); app.emit('tree-changed', p);
}

export function moveProject(p, delta) {
  const i = state.list.indexOf(p), j = i + delta;
  if (j < 0 || j >= state.list.length) return;
  [state.list[i], state.list[j]] = [state.list[j], state.list[i]];
  state.list.forEach((x, k) => { x.order = k; saveProject(x); });
  app.emit('projects-changed');
}

// ---------- Dateien ----------
export async function readFile(p, path, { signal } = {}) {
  const files = await getFiles(p);
  const rec = files.get(path);
  if (!rec) return null;
  if (rec.content == null && rec.remote && !rec.binary) {
    const src = state.remote.get(p.source);
    if (src) {
      const text = await src.fetchContent(p, rec, signal);
      rec.content = text; rec.baseline = text; rec.remote = false; rec.size = text.length;
      markDirty(rec.scope, path);
      app.emit('tree-changed', p);
    }
  }
  return rec.content;
}

export function getRec(p, path) { return filesSync(p)?.get(path); }

export function writeFile(p, path, content, { origin = 'user' } = {}) {
  const scope = scopeOf(p);
  const files = state.files.get(scope);
  if (!files) return;
  let rec = files.get(path);
  const created = !rec;
  if (!rec) { rec = makeRec(scope, path, content); rec.baseline = null; files.set(path, rec); }
  if (!created && rec.content === content) return;
  rec.content = content; rec.size = content.length; rec.mtime = Date.now(); rec.remote = false;
  markDirty(scope, path);
  app.emit('file-changed', { project: p, path, origin });
  if (created) app.emit('tree-changed', p);
  const live = state.live.get(p.id);
  if (live && origin !== 'live') live.onLocalWrite(path, content, origin);
}

export async function createFile(p, path, content = '', { origin = 'user' } = {}) {
  path = normalizePath(path);
  const files = await getFiles(p);
  if (files.has(path)) throw new Error(`„${path}“ existiert bereits.`);
  // Platzhalter für leeren Ordner entfernen
  const keep = dirname(path) ? dirname(path) + '/.keep' : null;
  if (keep && files.get(keep)?.placeholder) { files.delete(keep); markDeleted(scopeOf(p), keep); }
  const rec = makeRec(scopeOf(p), path, content);
  rec.baseline = null;
  files.set(path, rec);
  markDirty(rec.scope, path);
  app.emit('tree-changed', p);
  const live = state.live.get(p.id);
  if (live && origin !== 'live') live.onLocalCreate(path, content);
  return rec;
}

export async function createFolder(p, path) {
  path = normalizePath(path);
  const files = await getFiles(p);
  const keep = path + '/.keep';
  if ([...files.keys()].some((k) => k.startsWith(path + '/'))) throw new Error(`Ordner „${path}“ existiert bereits.`);
  const rec = { scope: scopeOf(p), path: keep, content: '', size: 0, placeholder: true, mtime: Date.now() };
  files.set(keep, rec);
  markDirty(rec.scope, keep);
  app.emit('tree-changed', p);
}

export async function deletePath(p, path, { origin = 'user' } = {}) {
  const files = await getFiles(p);
  const scope = scopeOf(p);
  const removed = [];
  for (const k of [...files.keys()]) {
    if (k === path || k.startsWith(path + '/')) {
      const rec = files.get(k);
      if (p.source === 'github' && rec?.sha && !rec.placeholder) (p.pendingDeletes ||= []).push(k);
      files.delete(k); markDeleted(scope, k); removed.push(k); dirty.get(scope)?.delete(k);
    }
  }
  // Leeren Elternordner erhalten
  const parent = dirname(path);
  if (parent && ![...files.keys()].some((k) => k.startsWith(parent + '/'))) {
    files.set(parent + '/.keep', { scope, path: parent + '/.keep', content: '', size: 0, placeholder: true, mtime: Date.now() });
    markDirty(scope, parent + '/.keep');
  }
  flush();
  if (p.pendingDeletes?.length) saveProject(p);
  app.emit('tree-changed', p);
  app.emit('paths-removed', { project: p, paths: removed });
  const live = state.live.get(p.id);
  if (live && origin !== 'live') for (const k of removed) live.onLocalDelete(k);
}

export async function renamePath(p, from, to) {
  to = normalizePath(to);
  const files = await getFiles(p);
  if (files.has(to) || [...files.keys()].some((k) => k.startsWith(to + '/'))) throw new Error(`„${to}“ existiert bereits.`);
  const scope = scopeOf(p);
  const moves = [];
  for (const k of [...files.keys()]) {
    if (k === from || k.startsWith(from + '/')) {
      const rec = files.get(k);
      const nk = to + k.slice(from.length);
      files.delete(k); markDeleted(scope, k);
      rec.path = nk; files.set(nk, rec); markDirty(scope, nk);
      moves.push([k, nk]);
    }
  }
  app.emit('tree-changed', p);
  app.emit('paths-renamed', { project: p, moves });
  const live = state.live.get(p.id);
  if (live) for (const [a, b] of moves) live.onLocalRename(a, b, files.get(b)?.content ?? '');
  return moves;
}

export async function duplicatePath(p, path) {
  const files = await getFiles(p);
  const rec = files.get(path);
  if (!rec) return;
  const m = /^(.*?)(\.[^./]*)?$/.exec(path);
  let n = 1, target;
  do { target = `${m[1]} Kopie${n > 1 ? ' ' + n : ''}${m[2] || ''}`; n++; } while (files.has(target));
  const content = rec.content ?? (await readFile(p, path)) ?? '';
  await createFile(p, target, content);
  return target;
}

// ---------- Anzeige-Filter ----------
const ignoreCache = new Map();
export function ignoreMatcher(p) {
  const files = filesSync(p);
  const gi = files?.get('.gitignore')?.content || '';
  const key = scopeOf(p);
  const cached = ignoreCache.get(key);
  if (cached && cached.text === gi) return cached.fn;
  const fn = compileGitignore(gi + '\n.git/\n');
  ignoreCache.set(key, { text: gi, fn });
  return fn;
}

export const isIndexed = (rec) => !(rec.remote || rec.binary || rec.size > INDEX_LIMIT || isBinaryPath(rec.path));
export const isModified = (rec) => rec.baseline != null && rec.content != null && rec.content !== rec.baseline;
export const isNew = (rec) => rec.baseline === null && !rec.placeholder;

export function setDisplay(p, mode) {
  p.display = mode; saveProject(p); app.emit('tree-changed', p);
}

/** Baumstruktur für die Seitenleiste */
export function buildTree(p) {
  const files = filesSync(p);
  const root = { name: p.name, path: '', dir: true, children: new Map() };
  if (!files) return root;
  const ignored = ignoreMatcher(p);
  const mode = p.display || 'all';
  for (const rec of files.values()) {
    if (mode === 'ignored' && !ignored(rec.path)) continue;
    if (mode === 'unindexed' && (rec.placeholder || isIndexed(rec))) continue;
    const parts = rec.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.children.has(seg)) {
        const dpath = parts.slice(0, i + 1).join('/');
        node.children.set(seg, { name: seg, path: dpath, dir: true, children: new Map(), ignored: ignored(dpath, true) });
      }
      node = node.children.get(seg);
    }
    if (rec.placeholder) continue;
    const name = parts[parts.length - 1];
    node.children.set(name, { name, path: rec.path, dir: false, rec, ignored: ignored(rec.path) });
  }
  return root;
}

export function sortedChildren(node) {
  return [...node.children.values()].sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' }) : a.dir ? -1 : 1));
}

// ---------- Branches (lokal) ----------
export async function switchBranch(p, name) {
  if (!p.branches[name]) return;
  if (p.branches[name].status !== 'synced') {
    const src = state.remote.get(p.source);
    if (src) await src.syncBranch(p, name);
  }
  p.branch = name;
  await saveProject(p);
  await getFiles(p);
  app.emit('projects-changed');
  app.emit('branch-switched', p);
}

export async function createBranch(p, name, from = p.branch) {
  name = name.trim().replace(/\s+/g, '-');
  if (!name || p.branches[name]) throw new Error('Ungültiger oder vorhandener Branch-Name.');
  const src = await getFiles(p, from);
  const scope = scopeOf(p, name);
  const map = new Map();
  for (const rec of src.values()) map.set(rec.path, { ...rec, scope });
  state.files.set(scope, map);
  await db.putMany('files', [...map.values()]);
  for (const r of map.values()) hooks.file?.(scope, r.path, false);
  p.branches[name] = { status: 'synced', syncedAt: Date.now(), local: true, from };
  await switchBranch(p, name);
}

export async function deleteBranch(p, name) {
  if (name === p.branch) throw new Error('Der aktive Branch kann nicht gelöscht werden.');
  await db.delByIndex('files', 'scope', scopeOf(p, name));
  state.files.delete(scopeOf(p, name));
  if (p.source === 'github' && !p.branches[name].local) p.branches[name] = { status: 'remote' };
  else delete p.branches[name];
  await saveProject(p);
  app.emit('projects-changed');
}

/** Dateien eines Scopes ersetzen (z. B. nach Sync) */
export async function replaceScopeFiles(p, branch, recs) {
  const scope = scopeOf(p, branch);
  await db.delByIndex('files', 'scope', scope);
  const map = new Map();
  for (const r of recs) { r.scope = scope; map.set(r.path, r); }
  state.files.set(scope, map);
  await db.putMany('files', recs);
  for (const r of recs) hooks.file?.(scope, r.path, false);
  app.emit('tree-changed', p);
}

// ---------- Änderungen von anderen Geräten (Synchronisierung) ----------
export async function applyRemoteProject(r) {
  const local = getProject(r.id);
  if (r.deleted) { if (local) await removeProject(local, { silent: true }); return; }
  if (!r.meta) return;
  if (!local) {
    const p = { ...r.meta, mtime: r.mtime, order: state.list.length };
    delete p.liveRoom; delete p.liveRole;
    state.list.push(p);
    await db.put('projects', cleanProject(p));
    app.emit('projects-changed');
    return;
  }
  if ((r.mtime || 0) <= (local.mtime || 0)) return;
  const keep = { liveRoom: local.liveRoom, liveRole: local.liveRole, order: local.order, collapsed: local.collapsed };
  const branchChanged = local.branch !== r.meta.branch;
  Object.assign(local, r.meta, keep, { mtime: r.mtime });
  await saveProject(local, { silent: true });
  if (branchChanged) { await getFiles(local).catch(() => {}); app.emit('branch-switched', local); }
  app.emit('projects-changed');
}

export async function applyRemoteFile(f) {
  const at = f.scope.indexOf('@');
  const p = getProject(f.scope.slice(0, at));
  // Dateiliste zuerst laden, damit keine gleichzeitige Anzeige einen veralteten Stand zwischenspeichert
  const map = p ? await getFiles(p, f.scope.slice(at + 1)).catch(() => null) : state.files.get(f.scope);
  const local = map ? map.get(f.path) : await db.get('files', [f.scope, f.path]).catch(() => null);
  if (local && (local.mtime || 0) > (f.mtime || 0)) return false;
  if (f.deleted) {
    if (!local) return false;
    map?.delete(f.path);
    await db.del('files', [f.scope, f.path]);
    if (p && map) { app.emit('tree-changed', p); app.emit('paths-removed', { project: p, paths: [f.path] }); }
    return true;
  }
  if (local && local.content === f.content) { local.mtime = f.mtime; return false; }
  const rec = { ...(local || {}), scope: f.scope, path: f.path, content: f.content, size: (f.content || '').length, mtime: f.mtime, remote: false, placeholder: !!f.placeholder };
  if (!local) rec.baseline = null;
  map?.set(f.path, rec);
  await db.put('files', rec);
  if (p && map) {
    if (!local) app.emit('tree-changed', p);
    else app.emit('file-changed', { project: p, path: f.path, origin: 'sync' });
  }
  return true;
}

export async function readRecord(scope, path) {
  return state.files.get(scope)?.get(path) || db.get('files', [scope, path]).catch(() => null);
}

export function markRecDirty(rec) { markDirty(rec.scope, rec.path); }

export function projectForScopeName(name) { return state.list.find((p) => p.name === name); }

export function allOpenableFiles() {
  const out = [];
  for (const p of state.list) {
    const files = filesSync(p);
    if (!files) continue;
    for (const rec of files.values()) if (!rec.placeholder) out.push({ project: p, path: rec.path, rec });
  }
  return out;
}

export { basename };
