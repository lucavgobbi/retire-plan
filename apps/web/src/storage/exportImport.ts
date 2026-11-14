// Lane B (Task 4). Versioned JSON export / import — PURE transform, no DOM.
// All user-facing JSON text and file I/O live in content/planFileUi.ts; this
// module must stay unit-testable without jsdom.
//
// Destructive-import contract (plan Task 4, order is normative):
//   1. parse + validate (parsePlanFile) — pure, no state touched, NO backup taken
//   2. preview (content/planFileUi.ts previewPlanFile)
//   3. confirm (shell/view — names exactly what is destroyed)
//   4. snapshot("pre-import")                     ← db.ts
//   5. swap + save                                ← shell/watcher
import type { PlanFile, PlanMeta, Workspace } from "../domain/types";
import { SCHEMA_VERSION, validatePlanFile, validateWorkspace } from "./schema";
import { migratePlanFile } from "./migrations";

export interface BuildPlanFileOptions {
  /** Injectable id generator (tests); defaults to a session-unique fallback. */
  makeId?: () => string;
  /** Injectable timestamp; defaults to now. */
  now?: () => string;
}

/**
 * Builds the exported PlanFile envelope from the live workspace.
 * A never-saved workspace (meta null) gets a SYNTHESIZED PlanMeta without
 * mutating the workspace — the live state keeps `meta: null` (lead's contract).
 */
export function buildPlanFile(w: Workspace, options: BuildPlanFileOptions = {}): PlanFile {
  const meta: PlanMeta | null = w.meta
    ? { ...w.meta }
    : {
        id: options.makeId?.() ?? synthesizedId(),
        name: "Untitled plan",
        updatedAt: (options.now ?? defaultNow)(),
      };
  return {
    schemaVersion: SCHEMA_VERSION,
    ...(w.baseScenario ? { baseScenario: structuredCopy(w.baseScenario) } : {}),
    ...(w.hiddenProjectionColumns !== undefined ? { hiddenProjectionColumns: [...w.hiddenProjectionColumns] } : {}),
    ...(w.hiddenProjectionCharts !== undefined ? { hiddenProjectionCharts: [...w.hiddenProjectionCharts] } : {}),
    plans: [{ meta, plan: structuredCopy(w.plan) }],
    scenarios: w.scenarios.map((s) => structuredCopy(s)),
  };
}

/** Serializes a PlanFile to pretty JSON (the on-disk / download format). */
export function planFileToText(planFile: PlanFile): string {
  return JSON.stringify(planFile, null, 2);
}

/** One-call export: workspace → envelope → JSON text. */
export function workspaceToText(w: Workspace, options: BuildPlanFileOptions = {}): string {
  return planFileToText(buildPlanFile(w, options));
}

// --- import -----------------------------------------------------------------

export interface ParseOk {
  ok: true;
  /** Validated workspace ready to dispatch as { type: "workspace/loaded" }. */
  workspace: Workspace;
  /** The validated envelope (for preview + "copy JSON for inspection"). */
  planFile: PlanFile;
  /** Payload version the raw file carried (0 = pre-versioning). */
  migratedFrom: number;
}
export interface ParseFailure {
  ok: false;
  errors: string[];
}

/**
 * Parses + validates + (when needed) migrates a parsed JSON value through the
 * full gate ladder: structural schema → migrations → engine validatePlan.
 * Takes the ALREADY-PARSED value to stay pure; JSON.parse happens in
 * content/planFileUi.parseImportText so DOM-free failures stay catchable here.
 */
export function parsePlanFile(json: unknown): ParseOk | ParseFailure {
  const migrated = migratePlanFile(json);
  if (!migrated.ok) return { ok: false, errors: migrated.errors };

  const planFile = migrated.planFile;
  const planCount = planFile.plans.length;
  if (planCount === 0) {
    return { ok: false, errors: ["The file contains no plans — nothing to load."] };
  }

  if (planCount !== 1) {
    return { ok: false, errors: ["This version supports exactly one plan per file. Split the file into single-plan workspaces before importing."] };
  }
  // Single-plan workspaces are the current model.
  const entry = planFile.plans[0]!;
  const workspace: Workspace = {
    meta: { ...entry.meta },
    ...(planFile.baseScenario ? { baseScenario: structuredCopy(planFile.baseScenario) } : {}),
    ...(planFile.hiddenProjectionColumns !== undefined ? { hiddenProjectionColumns: [...planFile.hiddenProjectionColumns] } : {}),
    ...(planFile.hiddenProjectionCharts !== undefined ? { hiddenProjectionCharts: [...planFile.hiddenProjectionCharts] } : {}),
    plan: entry.plan,
    scenarios: planFile.scenarios.filter(
      (scenario) =>
        scenario.basePlanId === entry.meta.id ||
        // Tolerance: hand-made or pre-schema files may reference a plan id that
        // no longer matches (or none at all). With one plan in the file there is
        // nothing else they can point to, so they load instead of vanishing.
        planCount === 1,
    ),
  };

  const errors = validateWorkspace(workspace);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, workspace, planFile, migratedFrom: migrated.fromVersion };
}

// --- internals --------------------------------------------------------------

function defaultNow(): string {
  return new Date().toISOString();
}

function synthesizedId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  return `plan-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Deep copy via the JSON envelope itself — export/import payloads must be JSON anyway. */
function structuredCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Re-export the version constant so consumers can hard-block future payloads
// without importing from two modules.
export { SCHEMA_VERSION };
