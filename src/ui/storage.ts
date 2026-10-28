import type { SaveMeta } from '../sim/save';

/** Emplacements de sauvegarde dans le navigateur : automatique (reprise de la partie) et rapide (Ctrl+S). */
export type Slot = 'auto' | 'quick';

export interface StoredSave extends SaveMeta {
  /** Sauvegarde compressée (`encodeSave`). */
  bytes: Uint8Array;
}

const DB_NAME = 'demiurge';
const STORE = 'saves';

let db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponible'));
  });
  // Un échec (navigation privée, stockage bloqué) ne doit pas condamner les essais suivants.
  db.catch(() => (db = null));
  return db;
}

function request<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error('Échec de la base de sauvegardes'));
      }),
  );
}

export function writeSlot(slot: Slot, save: StoredSave): Promise<void> {
  return request<IDBValidKey>('readwrite', (s) => s.put(save, slot)).then(() => undefined);
}

export async function readSlot(slot: Slot): Promise<StoredSave | null> {
  const v = await request<StoredSave | undefined>('readonly', (s) => s.get(slot));
  return v && v.bytes instanceof Uint8Array ? v : null;
}

/** Propose au navigateur d'enregistrer un fichier. */
export function downloadFile(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
