// Minimaler Promise-Wrapper um IndexedDB. Alles bleibt lokal im Browser.

const LEGACY_DB = 'luna-ide';
const DB_VERSION = 1;
let DB_NAME = LEGACY_DB;
let dbPromise;

/** Jedes Konto bekommt eine eigene Datenbank auf dem Gerät. */
export async function setDbUser(userId) {
  DB_NAME = 'luna-ide-u-' + String(userId).replace(/[^\w-]/g, '');
  dbPromise = null;
  await migrateLegacy();
}

// Daten aus der Zeit vor den Konten übernimmt das erste Konto, das sich auf diesem Gerät anmeldet.
async function migrateLegacy() {
  try {
    if (localStorage.getItem('luna.legacyMigrated')) return;
    localStorage.setItem('luna.legacyMigrated', '1');
    if (indexedDB.databases) {
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === LEGACY_DB)) return;
    }
    const legacy = await new Promise((resolve) => {
      const req = indexedDB.open(LEGACY_DB);
      req.onupgradeneeded = () => { req.transaction.abort(); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!legacy) return;
    const stores = ['projects', 'files', 'kv', 'ystate'].filter((s) => legacy.objectStoreNames.contains(s));
    for (const store of stores) {
      const rows = await new Promise((resolve) => {
        const r = legacy.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => resolve([]);
      });
      if (rows.length) await db.putMany(store, rows);
    }
    legacy.close();
    indexedDB.deleteDatabase(LEGACY_DB);
  } catch (e) { console.warn('Alte Daten konnten nicht übernommen werden', e); }
}

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) {
        const files = db.createObjectStore('files', { keyPath: ['scope', 'path'] });
        files.createIndex('scope', 'scope');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('ystate')) db.createObjectStore('ystate', { keyPath: 'room' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    Promise.resolve(fn(t.objectStore(store))).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  get: (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key))),
  all: (store) => tx(store, 'readonly', (s) => wrap(s.getAll())),
  put: (store, value) => tx(store, 'readwrite', (s) => { s.put(value); }),
  putMany: (store, values) => tx(store, 'readwrite', (s) => { for (const v of values) s.put(v); }),
  del: (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); }),
  byIndex: (store, index, value) => tx(store, 'readonly', (s) => wrap(s.index(index).getAll(value))),
  delByIndex: (store, index, value) => tx(store, 'readwrite', (s) => new Promise((resolve) => {
    const req = s.index(index).openKeyCursor(IDBKeyRange.only(value));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      s.delete(c.primaryKey);
      c.continue();
    };
  })),
};

// Einfacher Schlüssel/Wert-Speicher (Einstellungen, Workspace, Verlauf …)
export const kv = {
  async get(key, fallback = null) {
    try { const r = await db.get('kv', key); return r ? r.value : fallback; }
    catch { return fallback; }
  },
  set: (key, value) => db.put('kv', { key, value }).catch(() => {}),
};
