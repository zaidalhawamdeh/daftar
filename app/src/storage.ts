// Companies live in the browser's IndexedDB, on this computer only. Each save also keeps a rolling
// set of earlier versions so a bad afternoon can be undone.

const DB = 'daftar';
const COMPANIES = 'companies';
const BACKUPS = 'backups';
const KEEP_BACKUPS = 20;

export interface Stored {
  id: string;
  name: string;
  savedAt: string;
  text: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(COMPANIES)) db.createObjectStore(COMPANIES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BACKUPS)) db.createObjectStore(BACKUPS, { autoIncrement: true }).createIndex('company', 'id');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function save(rec: Stored): Promise<void> {
  const db = await open();
  const tx = db.transaction([COMPANIES, BACKUPS], 'readwrite');
  tx.objectStore(COMPANIES).put(rec);
  const backups = tx.objectStore(BACKUPS);
  backups.add(rec);
  const keys = backups.index('company').getAllKeys(IDBKeyRange.only(rec.id));
  keys.onsuccess = () => {
    const all = keys.result;
    for (const k of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) backups.delete(k);
  };
  await done(tx);
  db.close();
}

export interface Backup {
  key: number;
  savedAt: string;
}

// Earlier versions of one company, newest first.
export async function listBackups(id: string): Promise<Backup[]> {
  const db = await open();
  const store = db.transaction(BACKUPS).objectStore(BACKUPS);
  const out: Backup[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = store.index('company').openCursor(IDBKeyRange.only(id));
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      out.push({ key: cur.primaryKey as number, savedAt: (cur.value as Stored).savedAt });
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out.reverse();
}

export async function loadBackup(key: number): Promise<Stored | undefined> {
  const db = await open();
  const req = db.transaction(BACKUPS).objectStore(BACKUPS).get(key);
  const rec = await new Promise<Stored | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as Stored | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rec;
}

export async function list(): Promise<Omit<Stored, 'text'>[]> {
  const db = await open();
  const req = db.transaction(COMPANIES).objectStore(COMPANIES).getAll();
  const rows = await new Promise<Stored[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as Stored[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows.map(({ id, name, savedAt }) => ({ id, name, savedAt })).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export async function load(id: string): Promise<Stored | undefined> {
  const db = await open();
  const req = db.transaction(COMPANIES).objectStore(COMPANIES).get(id);
  const rec = await new Promise<Stored | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as Stored | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rec;
}
