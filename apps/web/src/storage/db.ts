// Lane B (Task 3). IndexedDB-backed StorageProvider — NATIVE IndexedDB API
// (core/captain decision: no `idb` package). A ~40-line promise wrapper is the
// only glue; all recovery/retention semantics live in core.ts.
//
// Two DISTINCT version numbers (never conflated):
//   * DB_VERSION      — object-store LAYOUT version; BOTH stores are created in
//     the first upgrade so backup retention never forces a DB bump.
//   * SCHEMA_VERSION  — the workspace-row payload version (schema.ts); payload
//     migrations (migrations.ts) need no DB bump.
//
// The IDBFactory is INJECTABLE so tests substitute fake-indexeddb directly.
import {
  createRowBackedStorageProvider,
  type RowDb,
  type StorageProvider,
} from "./core";

export const DB_NAME = "retire-plan";
/** Layout version of the object stores below; bump ONLY for store-shape changes. */
export const DB_VERSION = 1;
const WORKSPACE_STORE = "workspace";
const BACKUP_STORE = "backups";

export function createStorageProvider(
  idbFactory: IDBFactory | undefined = globalThis.indexedDB,
  options: { now?: () => string } = {},
): StorageProvider {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    dbPromise ??= openDatabase(idbFactory);
    return dbPromise;
  };

  const rowDb: RowDb = {
    async getWorkspaceRow(): Promise<unknown> {
      const db = await open();
      return requestToPromise(db.transaction(WORKSPACE_STORE, "readonly").objectStore(WORKSPACE_STORE).get("singleton"));
    },
    async putWorkspaceRow(row: unknown): Promise<void> {
      const db = await open();
      const tx = db.transaction(WORKSPACE_STORE, "readwrite");
      const committed = transactionToPromise(tx);
      tx.objectStore(WORKSPACE_STORE).put(row as object, "singleton");
      await committed;
    },
    async getBackupRows(): Promise<{ key: string; createdAt: string; workspace: unknown }[]> {
      const db = await open();
      const tx = db.transaction(BACKUP_STORE, "readonly");
      const store = tx.objectStore(BACKUP_STORE);
      const entries = await requestToPromise(store.getAll()) as { key: number; createdAt: string; workspace: unknown }[];
      const rows = entries.map((entry) => ({ key: String(entry.key), createdAt: entry.createdAt, workspace: entry.workspace }));
      return rows;
    },
    async addBackupRow(createdAt, workspace): Promise<string> {
      const db = await open();
      const tx = db.transaction(BACKUP_STORE, "readwrite");
      const committed = transactionToPromise(tx);
      const key = await requestToPromise(
        tx.objectStore(BACKUP_STORE).add({
          createdAt,
          workspace,
        } as object),
      );
      await committed;
      return String(key);
    },
    async deleteBackupRow(key: string): Promise<void> {
      const db = await open();
      const tx = db.transaction(BACKUP_STORE, "readwrite");
      const committed = transactionToPromise(tx);
      tx.objectStore(BACKUP_STORE).delete(Number(key));
      await committed;
    },
  };

  return createRowBackedStorageProvider(rowDb, options);
}

function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
  });
}

/** promise wrapper for a single IDBRequest. */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB operation failed."));
  });
}

function openDatabase(idbFactory: IDBFactory | undefined): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!idbFactory) {
      reject(new Error("IndexedDB is unavailable in this environment (e.g. private browsing)."));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = idbFactory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(new Error(`IndexedDB open failed: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      // BOTH stores in the first upgrade — backup retention must never require a
      // DB_VERSION bump (plan Task 3). Out-of-line keys; backups key auto-increments.
      if (!db.objectStoreNames.contains(WORKSPACE_STORE)) {
        db.createObjectStore(WORKSPACE_STORE);
      }
      if (!db.objectStoreNames.contains(BACKUP_STORE)) {
        db.createObjectStore(BACKUP_STORE, { keyPath: "key", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error(`IndexedDB open failed: ${request.error?.message ?? "unknown error"}`));
    request.onblocked = () =>
      reject(new Error("IndexedDB upgrade is blocked by another open RetirePlan tab."));
  });
}

/** Process-wide singleton used by the autosave hook and shell boot. */
export const storage: StorageProvider = createStorageProvider();

export { createRowBackedStorageProvider, startFresh } from "./core";
export type { LoadResult, LoadOutcome, RecoveryOutcome, StorageProvider, RowDb } from "./core";
