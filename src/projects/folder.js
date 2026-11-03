// Lokale Ordner öffnen (File System Access API oder <input webkitdirectory>) + ZIP-Export.
import { app } from '../core/store.js';
import { kv } from '../core/db.js';
import { h, looksLikeText, isBinaryPath } from '../core/util.js';
import { state, createProject, replaceScopeFiles, getFiles, isModified, filesSync, readFile } from './projects.js';

const SKIP = /^(node_modules|\.git|\.next|\.cache|dist|build|target|__pycache__|\.venv|venv)$/;
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_BIN = 5 * 1024 * 1024;

async function fileToRec(path, file) {
  if (file.size > MAX_BIN) return { path, content: null, binary: true, size: file.size, tooLarge: true };
  const buf = new Uint8Array(await file.slice(0, 8000).arrayBuffer());
  if (!isBinaryPath(path) && looksLikeText(buf) && file.size <= MAX_TEXT) {
    const text = await file.text();
    return { path, content: text, baseline: text, size: text.length };
  }
  return { path, content: null, blob: file, binary: true, size: file.size };
}

async function readHandle(dir, prefix = '', out = [], skipped = { n: 0 }) {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      if (SKIP.test(name)) { skipped.n++; continue; }
      const before = out.length;
      await readHandle(handle, path, out, skipped);
      if (out.length === before) out.push({ path: path + '/.keep', content: '', size: 0, placeholder: true });
    } else {
      out.push(await fileToRec(path, await handle.getFile()));
    }
  }
  return out;
}

export const canPickDirectory = () => 'showDirectoryPicker' in window;

export async function openFolder() {
  if (canPickDirectory()) {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' }).catch((e) => { if (e.name === 'AbortError') return null; throw e; });
    if (!dir) return null;
    const recs = await readHandle(dir);
    const p = await createProject({ name: dir.name, source: 'folder', files: {} });
    await replaceScopeFiles(p, p.branch, recs);
    await kv.set('handle:' + p.id, dir);
    app.notify(`Ordner „${dir.name}“ geöffnet (${recs.length} Dateien).`);
    return p;
  }
  // Fallback: Ordner-Upload (nur lesen)
  return new Promise((resolve, reject) => {
    const input = h('input', { type: 'file', webkitdirectory: true, multiple: true, style: 'display:none' });
    input.addEventListener('change', async () => {
      try {
        const list = [...input.files];
        if (!list.length) return resolve(null);
        const root = list[0].webkitRelativePath.split('/')[0];
        const recs = [];
        for (const f of list) {
          const rel = f.webkitRelativePath.split('/').slice(1).join('/');
          if (rel.split('/').some((seg) => SKIP.test(seg))) continue;
          recs.push(await fileToRec(rel, f));
        }
        const p = await createProject({ name: root, source: 'upload', files: {} });
        await replaceScopeFiles(p, p.branch, recs);
        app.notify(`Ordner „${root}“ importiert (${recs.length} Dateien).`);
        resolve(p);
      } catch (e) { reject(e); } finally { input.remove(); }
    });
    document.body.append(input);
    input.click();
  });
}

/** Dateien (z. B. per Drag & Drop) in ein Projekt importieren */
export async function importFiles(p, fileList, base = '') {
  const { createFile, writeFile } = await import('./projects.js');
  const files = await getFiles(p);
  let n = 0;
  for (const f of fileList) {
    const path = (base ? base + '/' : '') + (f.webkitRelativePath || f.name);
    const rec = await fileToRec(path, f);
    if (rec.content != null) {
      if (files.has(path)) writeFile(p, path, rec.content); else await createFile(p, path, rec.content);
    } else {
      files.set(path, { ...rec, scope: `${p.id}@${p.branch}`, mtime: Date.now() });
      (await import('./projects.js')).markRecDirty(files.get(path));
    }
    n++;
  }
  app.emit('tree-changed', p);
  return n;
}

async function ensurePermission(handle, mode = 'readwrite') {
  if ((await handle.queryPermission?.({ mode })) === 'granted') return true;
  return (await handle.requestPermission?.({ mode })) === 'granted';
}

async function resyncFolder(p) {
  const dir = await kv.get('handle:' + p.id);
  if (!dir) throw new Error('Für diesen Ordner gibt es keinen Zugriff mehr. Bitte erneut öffnen.');
  if (!(await ensurePermission(dir, 'read'))) throw new Error('Kein Zugriff auf den Ordner erlaubt.');
  const old = await getFiles(p);
  const recs = await readHandle(dir);
  let kept = 0;
  for (const r of recs) {
    const o = old.get(r.path);
    if (o && isModified(o)) { r.content = o.content; r.baseline = o.baseline; kept++; }
  }
  await replaceScopeFiles(p, p.branch, recs);
  app.notify(`„${p.name}“ neu eingelesen${kept ? ` – ${kept} ungespeicherte Änderungen behalten` : ''}.`);
}

/** Geänderte Dateien zurück in den Ordner schreiben */
export async function writeBackFolder(p) {
  const dir = await kv.get('handle:' + p.id);
  if (!dir) throw new Error('Kein Ordnerzugriff vorhanden.');
  if (!(await ensurePermission(dir, 'readwrite'))) throw new Error('Schreibzugriff wurde nicht erlaubt.');
  let n = 0;
  for (const rec of filesSync(p).values()) {
    if (rec.placeholder || rec.content == null || rec.content === rec.baseline) continue;
    const parts = rec.path.split('/');
    let d = dir;
    for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
    const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(rec.content); await w.close();
    rec.baseline = rec.content; n++;
    (await import('./projects.js')).markRecDirty(rec);
  }
  app.emit('tree-changed', p);
  return n;
}

state.remote.set('folder', {
  fetchContent: async () => '',
  syncBranch: async () => {},
  resync: resyncFolder,
});

// ---------- ZIP (unkomprimiert, „stored“) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function zipProject(p) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const rec of filesSync(p).values()) {
    if (rec.placeholder) continue;
    let data;
    if (rec.content != null) data = enc.encode(rec.content);
    else if (rec.blob) data = new Uint8Array(await rec.blob.arrayBuffer());
    else if (rec.remote) data = enc.encode((await readFile(p, rec.path).catch(() => '')) || '');
    else continue;
    const name = enc.encode(rec.path);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  const count = central.length / 2;
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, count, true); end.setUint16(10, count, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
