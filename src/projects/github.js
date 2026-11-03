// GitHub als Quelle: Repos importieren, Branches synchronisieren (Bild 1: Synchronisiert / Wird synchronisiert / Nicht synchronisiert).
import { app } from '../core/store.js';
import { isBinaryPath } from '../core/util.js';
import { state, createProject, saveProject, replaceScopeFiles, getFiles, scopeOf, isModified, markRecDirty, switchBranch } from './projects.js';

const API = 'https://api.github.com';
const MAX_EAGER_FILES = 600;
const MAX_EAGER_SIZE = 256 * 1024;
const syncs = new Map(); // `${id}@${branch}` → AbortController

function headers(raw = false) {
  const h = { Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json' };
  if (app.settings.githubToken) h.Authorization = `Bearer ${app.settings.githubToken}`;
  return h;
}

async function api(path, signal) {
  const res = await fetch(API + path, { headers: headers(), signal });
  if (!res.ok) {
    let msg = `GitHub antwortet mit ${res.status}`;
    if (res.status === 404) msg = 'Repository oder Branch nicht gefunden (bei privaten Repos Token in den Einstellungen hinterlegen).';
    if (res.status === 403 || res.status === 429) msg = 'GitHub-Limit erreicht – bitte später erneut oder Token in den Einstellungen hinterlegen.';
    if (res.status === 401) msg = 'GitHub-Token ungültig.';
    throw new Error(msg);
  }
  return res.json();
}

export function parseRepo(input) {
  const s = input.trim().replace(/\.git$/, '');
  let m = /github\.com[/:]([\w.-]+)\/([\w.-]+)(?:\/tree\/([^?#]+))?/.exec(s);
  if (m) return { owner: m[1], repo: m[2], branch: m[3] ? decodeURIComponent(m[3]) : null };
  m = /^([\w.-]+)\/([\w.-]+)(?:@(.+))?$/.exec(s);
  if (m) return { owner: m[1], repo: m[2], branch: m[3] || null };
  return null;
}

async function fetchContent(p, rec, signal) {
  const path = rec.path.split('/').map(encodeURIComponent).join('/');
  let res;
  if (app.settings.githubToken) {
    res = await fetch(`${API}/repos/${p.owner}/${p.repo}/contents/${path}?ref=${encodeURIComponent(p.branch)}`, { headers: headers(true), signal });
  } else {
    res = await fetch(`https://raw.githubusercontent.com/${p.owner}/${p.repo}/${encodeURIComponent(p.branch)}/${path}`, { signal });
  }
  if (!res.ok) throw new Error(`Datei konnte nicht geladen werden (${res.status}).`);
  return res.text();
}

async function listBranches(p) {
  const list = await api(`/repos/${p.owner}/${p.repo}/branches?per_page=100`);
  let changed = false;
  for (const b of list) {
    if (!p.branches[b.name]) { p.branches[b.name] = { status: 'remote', sha: b.commit.sha }; changed = true; }
    else if (p.branches[b.name].remoteSha !== b.commit.sha) { p.branches[b.name].remoteSha = b.commit.sha; changed = true; }
  }
  if (changed) { await saveProject(p); app.emit('projects-changed'); }
  return list;
}

/** Branch herunterladen: Dateibaum + kleine Textdateien (große/binäre bleiben „nicht indiziert“ und laden bei Bedarf). */
async function syncBranch(p, branch, { keepLocal = true } = {}) {
  const key = `${p.id}@${branch}`;
  if (syncs.has(key)) return;
  const ctrl = new AbortController();
  syncs.set(key, ctrl);
  const prev = p.branches[branch] || {};
  p.branches[branch] = { ...prev, status: 'syncing', progress: 0 };
  app.emit('projects-changed');
  try {
    const tree = await api(`/repos/${p.owner}/${p.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, ctrl.signal);
    const old = keepLocal ? await getFiles(p, branch).catch(() => new Map()) : new Map();
    const recs = [];
    const toFetch = [];
    for (const item of tree.tree) {
      if (item.type !== 'blob') continue;
      const prevRec = old.get(item.path);
      if (prevRec && prevRec.sha === item.sha && prevRec.content != null) { recs.push({ ...prevRec }); continue; }
      if (prevRec && isModified(prevRec)) { recs.push({ ...prevRec, sha: item.sha, conflict: prevRec.sha !== item.sha }); continue; }
      const binary = isBinaryPath(item.path);
      const rec = { path: item.path, sha: item.sha, size: item.size || 0, content: null, baseline: null, remote: true, binary, mtime: Date.now() };
      recs.push(rec);
      if (!binary && item.size <= MAX_EAGER_SIZE && toFetch.length < MAX_EAGER_FILES) toFetch.push(rec);
    }
    // lokal neu angelegte Dateien behalten
    for (const r of old.values()) if (r.baseline === null && !r.remote && !recs.some((x) => x.path === r.path)) recs.push({ ...r });
    let done = 0;
    const total = toFetch.length || 1;
    const branchProj = { ...p, branch };
    const worker = async () => {
      while (toFetch.length) {
        const rec = toFetch.shift();
        try {
          const text = await fetchContent(branchProj, rec, ctrl.signal);
          rec.content = text; rec.baseline = text; rec.remote = false; rec.size = text.length;
        } catch (e) { if (ctrl.signal.aborted) throw e; }
        done++;
        p.branches[branch].progress = done / total;
        if (done % 10 === 0) app.emit('sync-progress', { project: p, branch });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    await replaceScopeFiles(p, branch, recs);
    p.branches[branch] = { status: 'synced', syncedAt: Date.now(), sha: tree.sha, remoteSha: tree.sha };
    await saveProject(p);
    const conflicts = recs.filter((r) => r.conflict).length;
    app.notify(`${p.name}: Branch „${branch}“ synchronisiert (${recs.length} Dateien${conflicts ? `, ${conflicts} lokal geänderte behalten` : ''}).`);
  } catch (e) {
    if (ctrl.signal.aborted) {
      p.branches[branch] = prev.status === 'synced' ? prev : { status: 'remote' };
      app.notify(`Synchronisierung von „${branch}“ abgebrochen.`);
    } else {
      p.branches[branch] = prev.status === 'synced' ? prev : { status: 'remote', error: e.message };
      app.notify(e.message, { type: 'error' });
    }
    await saveProject(p);
    throw e;
  } finally {
    syncs.delete(key);
    app.emit('projects-changed');
    app.emit('tree-changed', p);
  }
}

export function cancelSync(p, branch) { syncs.get(`${p.id}@${branch}`)?.abort(); }
export const isSyncing = (p, branch) => syncs.has(`${p.id}@${branch}`);

export async function importGitHub(input) {
  const parsed = parseRepo(input);
  if (!parsed) throw new Error('Bitte „besitzer/repo“ oder eine GitHub-URL angeben.');
  const info = await api(`/repos/${parsed.owner}/${parsed.repo}`);
  const branch = parsed.branch || info.default_branch;
  const p = await createProject({
    name: info.name, source: 'github', branch, files: {},
    extra: { owner: info.owner.login, repo: info.name, description: info.description || '', private: info.private, defaultBranch: info.default_branch, htmlUrl: info.html_url },
  });
  p.branches = { [branch]: { status: 'remote' } };
  await saveProject(p);
  listBranches(p).catch(() => {});
  syncBranch(p, branch, { keepLocal: false }).catch(() => {});
  return p;
}

state.remote.set('github', {
  fetchContent,
  syncBranch: (p, b) => syncBranch(p, b),
  resync: async (p) => { await listBranches(p).catch(() => {}); await syncBranch(p, p.branch); },
  listBranches,
  cancelSync,
});

export { syncBranch, listBranches, switchBranch, scopeOf, markRecDirty };
