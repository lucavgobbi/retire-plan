// Lane B (Task 3). In-memory StorageProvider for unit tests and storybook-less
// demos. Same semantics as the IndexedDB provider (built on the shared core) —
// persistence tests exercise the recovery ladder here with zero dependencies.
import { createRowBackedStorageProvider, type RowDb, type StorageProvider } from "./core";

export interface MemoryRowDbOptions {
  /** Seed a raw (possibly corrupt / foreign-version) workspace row before load. */
  seedWorkspaceRow?: unknown;
  /** Seed raw backup rows (key 1..n, createdAt asc). */
  seedBackupRows?: { createdAt: string; workspace: unknown }[];
  now?: () => string;
}

export function createMemoryRowDb(options: MemoryRowDbOptions = {}): RowDb {
  let workspaceRow: unknown = options.seedWorkspaceRow;
  let nextKey = 1;
  let backups: { key: string; createdAt: string; workspace: unknown }[] =
    (options.seedBackupRows ?? []).map((row) => ({
      key: String(nextKey++),
      createdAt: row.createdAt,
      workspace: row.workspace,
    }));

  return {
    async getWorkspaceRow(): Promise<unknown> {
      return workspaceRow;
    },
    async putWorkspaceRow(row: unknown): Promise<void> {
      workspaceRow = row;
    },
    async getBackupRows(): Promise<{ key: string; createdAt: string; workspace: unknown }[]> {
      return [...backups];
    },
    async addBackupRow(createdAt, workspace): Promise<string> {
      const key = String(nextKey++);
      backups.push({ key, createdAt, workspace });
      return key;
    },
    async deleteBackupRow(key: string): Promise<void> {
      backups = backups.filter((row) => row.key !== key);
    },
  };
}

export function createMemoryStorageProvider(options: MemoryRowDbOptions = {}): StorageProvider {
  return createRowBackedStorageProvider(createMemoryRowDb(options), { now: options.now });
}
