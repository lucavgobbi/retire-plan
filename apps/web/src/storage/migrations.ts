// Lane B (Task 3/4). Version migration for persisted JSON payloads.
//
// Two unrelated version numbers exist (see schema.ts / db.ts):
//   * SCHEMA_VERSION      — the PlanFile JSON payload version (export/import files,
//                           also reused as the workspace-row payload version in db.ts)
//   * DB_VERSION          — the IndexedDB object-store layout version (db.ts only)
// A payload bump does not require a DB bump and vice versa.
//
// MIGRATIONS is the forward-looking hook table: entry N migrates a payload from
// schema vN to the next defined version. v0 ("pre-versioning" payloads missing
// schemaVersion) migrates identically to v1, which is its own first real version.
// When Task 2's schema ever revs to v2, add a `1: { to: 2, step: ... }` entry —
// unknown and gapped versions are hard errors, never silent best-effort loads.
import type { PlanFile } from "../domain/types";
import { SCHEMA_VERSION, isFiniteNumber, isRecord, validatePlanFile } from "./schema";

interface MigrationOk {
  ok: true;
  /** Fully migrated + validated payload, safe to treat as the current schema. */
  planFile: PlanFile;
  /** Payload version the raw value carried (0 = pre-versioning file). */
  fromVersion: number;
}
interface MigrationFailure {
  ok: false;
  errors: string[];
  /** Set (non-null) only when the payload is from a NEWER schema than this app knows. */
  newerVersion: number | null;
}

export type MigrationStep = (value: Record<string, unknown>) => Record<string, unknown>;

/** Hook table: key = payload version being migrated FROM. */
export const MIGRATIONS: Record<number, { to: number; step: MigrationStep }> = {
  // v0 → v1: the first versioning pass renamed nothing; only stamp the version.
  0: { to: 1, step: (value) => ({ ...value, schemaVersion: SCHEMA_VERSION }) },
};

/** Human-facing reason a payload could not be interpreted at all. */
function versionOf(raw: Record<string, unknown>): number | null {
  if (raw.schemaVersion === undefined) return 0; // pre-versioning file
  if (!isFiniteNumber(raw.schemaVersion) || !Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 0) return null;
  return raw.schemaVersion;
}

export function migratePlanFile(raw: unknown): MigrationOk | MigrationFailure {
  if (!isRecord(raw)) {
    return { ok: false, errors: ["The file is not a JSON object — this is not a BudgetTool plan file."], newerVersion: null };
  }
  const version = versionOf(raw);
  if (version === null) {
    return {
      ok: false,
      errors: ['The file\'s "schemaVersion" is not a number — this is not a BudgetTool plan file.'],
      newerVersion: null,
    };
  }
  const fromVersion = version;

  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `This file was saved with a newer version of BudgetTool (file schema v${version}; ` +
          `this app understands v${SCHEMA_VERSION}). Update BudgetTool first, or copy the file's ` +
          "JSON text for inspection — it was not modified or loaded.",
      ],
      newerVersion: version,
    };
  }

  let value: Record<string, unknown> = raw;
  let current = version;
  while (current < SCHEMA_VERSION) {
    const entry = MIGRATIONS[current];
    if (!entry) {
      return {
        ok: false,
        errors: [
          `No migration path is defined from schema v${current} to v${SCHEMA_VERSION}. ` +
            "The file may be damaged or hand-edited; its data was not modified.",
        ],
        newerVersion: null,
      };
    }
    try {
      value = entry.step(value);
    } catch (error) {
      return {
        ok: false,
        errors: [
          `The file could not be migrated to the current schema (${
            error instanceof Error ? error.message : "unknown error"
          }). Its data was not modified.`,
        ],
        newerVersion: null,
      };
    }
    current = entry.to;
  }

  // Migration output still goes through the full structural + semantic gate.
  const errors = validatePlanFile(value);
  if (errors.length > 0) return { ok: false, errors, newerVersion: null };
  return { ok: true, planFile: value as unknown as PlanFile, fromVersion };
}

// --- workspace persistence rows (db.ts) -------------------------------------
// A row is `{ schemaVersion, workspace }`; future revisions migrate row.workspace
// through the same hook table and bump row.schemaVersion. Exposed here so db.ts
// (and its future revisions) has exactly one versioning table to consume.

export interface RowMigrationOk {
  ok: true;
  schemaVersion: number;
  /** Migrated workspace payload (NOT yet re-validated; db.ts validates next). */
  workspace: unknown;
}
export interface RowMigrationFailure {
  ok: false;
  errors: string[];
  newerVersion: number | null;
}

export function migrateWorkspaceRow(raw: unknown): RowMigrationOk | RowMigrationFailure {
  if (!isRecord(raw)) {
    return { ok: false, errors: ["The persisted workspace entry is not an object."], newerVersion: null };
  }
  const version = versionOf(raw);
  if (version === null) {
    return { ok: false, errors: ['The persisted workspace entry has a non-numeric "schemaVersion".'], newerVersion: null };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `This workspace was saved by a newer version of BudgetTool (schema v${version} vs ` +
          `v${SCHEMA_VERSION} here). Nothing was deleted or modified.`,
      ],
      newerVersion: version,
    };
  }
  // At the current version there is nothing to do; db.ts re-VALIDATES the payload next.
  if (version === SCHEMA_VERSION) {
    return { ok: true, schemaVersion: SCHEMA_VERSION, workspace: raw.workspace };
  }
  // Walk the hook table. For rows, the v0→v1 step is envelope-level in FILES (it only
  // stamps schemaVersion) and a no-op payload-wise here; payload steps from future
  // revisions apply to `workspace` itself.
  let workspace: unknown = raw.workspace;
  let current = version;
  while (current < SCHEMA_VERSION) {
    const entry = MIGRATIONS[current];
    if (!entry) {
      return { ok: false, errors: [`No migration path from persisted schema v${current}.`], newerVersion: null };
    }
    if (current > 0) {
      workspace = isRecord(workspace) ? entry.step(workspace) : entry.step({});
    }
    current = entry.to;
  }
  return { ok: true, schemaVersion: SCHEMA_VERSION, workspace };
}
