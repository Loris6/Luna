// Minimaler Promise-Wrapper um IndexedDB. Alles bleibt lokal im Browser.

const DB_NAME = 'luna-ide';
const DB_VERSION = 1;
let dbPromise;

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
