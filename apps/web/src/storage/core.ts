// Lane B (Task 3). StorageProvider semantics — BACKEND-AGNOSTIC core.
//
// db.ts (IndexedDB) and memory.ts (tests) each implement the tiny RowDb seam
// below; the "never destroys data" recovery ladder is written exactly once here:
//   * load(): clean DB → fresh; valid row → loaded; corrupt/foreign-version row
//     → recoverable (raw row kept in place, newest valid backup offered)
//   * save(): refuses INVALID workspaces (throw) and refuses to overwrite a row
//     saved by a NEWER app version — safe errors, no silent data loss
//   * snapshot(reason): copies the CURRENT row into `backups` — even a corrupt
//     one (pre-import contract Task 4 step 4; "start fresh" backup first) —
//     FIFO-capped at 3
//   * restore(): returns the newest VALID backup (corrupt backups are skipped,
//     not served and not deleted)
//   * readRawRow(): raw persisted row verbatim, for the recovery UI's debug
//     download — no interpretation, no validation.
//
// WRITE LINEARIZATION (review fix for the cross-save race): the autosave hook's
// local queue is NOT sufficient — independent callers (import/restore/startFresh
// flows) write through the SAME provider. Every operation here is therefore
// serialized through one shared chain, and destructive multi-step flows run via
// runExclusive() so no interleaved save can land between their steps.
import type { Workspace } from "../domain/types";
import { createEmptyWorkspace } from "../domain/defaults";
import { SCHEMA_VERSION, validateWorkspace } from "./schema";
import { migrateWorkspaceRow } from "./migrations";

export interface LoadOutcome {
  kind: "loaded" | "fresh";
  workspace: Workspace;
}
export interface RecoveryOutcome {
  kind: "recoverable";
  /** Newest valid backup, if any — also obtainable later via restore(). */
  offered: Workspace | null;
}
export type LoadResult = LoadOutcome | RecoveryOutcome;

export interface StorageProvider {
  load(): Promise<LoadResult>;
  save(w: Workspace): Promise<void>;
  snapshot(reason: string): Promise<void>;
  restore(): Promise<Workspace | null>;
  /** Raw workspace row exactly as persisted (undefined if none) — debug/recovery UI. */
  readRawRow(): Promise<unknown>;
  /**
   * Runs op with EXCLUSIVE serialized access (no other read/write can interleave).
   * REQUIRED for destructive flows: backup-then-swap sequences must be atomic
   * against autosave and other writers.
   */
  runExclusive<T>(op: (provider: StorageProvider) => Promise<T>): Promise<T>;
}

/**
 * Backend seam: one workspace row + a keyed set of backup rows. Backups are
 * write-mostly (FIFO evictions delete); keys are comparable integers (newer >
 * older is NOT guaranteed by implementations — restore() sorts by createdAt).
 */
export interface RowDb {
  /** undefined = no row yet (clean). */
  getWorkspaceRow(): Promise<unknown>;
  putWorkspaceRow(row: unknown): Promise<void>;
  getBackupRows(): Promise<{ key: string; createdAt: string; workspace: unknown }[]>;
  addBackupRow(createdAt: string, workspace: unknown): Promise<string>;
  deleteBackupRow(key: string): Promise<void>;
}

/**
 * Restores the newest backup first (snapshot of NOW), then (over)writes the
 * workspace row with `fresh`. Runs atomically — never calls the provider from
 * outside runExclusive.
 */
export async function startFresh(provider: StorageProvider, fresh: Workspace): Promise<void> {
  await provider.runExclusive(async (p) => {
    await p.snapshot("start-fresh");
    await p.save(fresh);
  });
}

export function createRowBackedStorageProvider(
  backend: RowDb,
  options: { now?: () => string } = {},
): StorageProvider {
  const now = options.now ?? (() => new Date().toISOString());
  const FIFO_CAP = 3;

  /** Shared op chain — EVERY operation (read too) runs through this, tail-linked. */
  let chain: Promise<unknown> = Promise.resolve();
  const linearize = <T>(op: () => Promise<T>): Promise<T> => {
    const run = chain.then(op, op); // a failed op must not poison the chain
    // Keep the chain alive; let the CALLER's promise carry the error.
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  async function newestValidBackup(): Promise<Workspace | null> {
    const rows = await backend.getBackupRows();
    const newestFirst = [...rows].sort(newestBackupFirst);
    for (const row of newestFirst) {
      if (validateWorkspace(row.workspace).length === 0) return row.workspace as Workspace;
    }
    return null;
  }

  const direct: StorageProvider = {
    load: loadDirect,
    save: saveDirect,
    snapshot: snapshotDirect,
    restore: newestValidBackup,
    readRawRow: () => backend.getWorkspaceRow(),
    runExclusive: (op) => op(direct),
  };
  return {
    load: () => linearize(direct.load),
    save: (workspace) => linearize(() => direct.save(workspace)),
    snapshot: (reason) => linearize(() => direct.snapshot(reason)),
    restore: () => linearize(direct.restore),
    readRawRow: () => linearize(direct.readRawRow),
    runExclusive: (op) => linearize(() => op(direct)),
  };

  // --- direct (barrier-internal) op bodies, shared by plain + exclusive paths ---
  function loadDirect(): Promise<LoadResult> {
    return (async () => {
      const raw = await backend.getWorkspaceRow();
      if (raw === undefined) return { kind: "fresh", workspace: createEmptyWorkspace() } as const;
      const migrated = migrateWorkspaceRow(raw);
      const workspace: unknown = migrated.ok ? migrated.workspace : undefined;
      if (!migrated.ok || validateWorkspace(workspace).length > 0) {
        return { kind: "recoverable", offered: await newestValidBackup() } as const;
      }
      return { kind: "loaded", workspace: workspace as Workspace } as const;
    })();
  }

  async function saveDirect(w: Workspace): Promise<void> {
    const errors = validateWorkspace(w);
    if (errors.length > 0) {
      throw new Error(
        `Refused to save an invalid workspace (data kept untouched). Problems: ${errors.join("; ")}`,
      );
    }
    const existing = await backend.getWorkspaceRow();
    if (
      typeof (existing as Record<string, unknown> | undefined)?.schemaVersion === "number" &&
      (existing as { schemaVersion: number }).schemaVersion > SCHEMA_VERSION
    ) {
      throw new Error(
        `Refused to overwrite a workspace row saved by a newer RetirePlan ` +
          `(${String((existing as { schemaVersion: number }).schemaVersion)} > ${SCHEMA_VERSION}). ` +
          "Snapshot it and update the app first.",
      );
    }
    const stamped: Workspace = w.meta ? { ...w, meta: { ...w.meta, updatedAt: now() } } : w;
    await backend.putWorkspaceRow({
      singleton: "singleton",
      schemaVersion: SCHEMA_VERSION,
      workspace: structuredCloneJson(stamped),
    });
  }

  async function snapshotDirect(reason: string): Promise<void> {
    const raw = await backend.getWorkspaceRow();
    if (raw === undefined || !isRecordRow(raw)) return;
    await backend.addBackupRow(now(), raw.workspace);
    const rows = await backend.getBackupRows();
    if (rows.length > FIFO_CAP) {
      const newestFirst = [...rows].sort(newestBackupFirst);
      for (const row of newestFirst.slice(FIFO_CAP)) {
        await backend.deleteBackupRow(row.key);
      }
    }
  }
}

function isRecordRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Auto-increment keys preserve insertion order when timestamps tie. */
function newestBackupFirst(a: { createdAt: string; key: string }, b: { createdAt: string; key: string }): number {
  return compareDesc(a.createdAt, b.createdAt) || Number(b.key) - Number(a.key);
}

function compareDesc(a: string, b: string): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function structuredCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
