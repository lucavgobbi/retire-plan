// Lane B (Task 4). File-UI helpers — the ONLY storage-adjacent module allowed to
// touch the DOM, and every touch below is INJECTABLE (helpers are used both in
// the app and in jsdom tests where URL.createObjectURL / FileReader need shims).
//
// Destructive-import order lives in the hook: parse (pure) → preview → user
// confirm → snapshot("pre-import") → swap + save. Parse failures NEVER take a
// backup and never touch state (exportImport.ts owns that purity).
import { useCallback, useState } from "react";
import type { PlanFile, Workspace } from "../domain/types";
import { createEmptyWorkspace } from "../domain/defaults";
import {
  parsePlanFile,
  SCHEMA_VERSION,
  workspaceToText,
  type ParseOk,
} from "../storage/exportImport";
import { storage, type StorageProvider } from "../storage/db";
import { suspendAutosave } from "../storage/useAutosave";
import { validateWorkspace } from "../storage/schema";
import { useStore } from "../store/api";
import { withCurrentAge } from "../domain/age";

// --- DOM seam ----------------------------------------------------------------

export interface DomHelpers {
  doc: Document;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

/** Convenience default resolving to the ambient document (browser). */
export function ambientDom(): DomHelpers | null {
  if (typeof document === "undefined") return null;
  return {
    doc: document,
    createObjectURL: typeof URL.createObjectURL === "function"
      ? (blob) => URL.createObjectURL(blob)
      : undefined,
    revokeObjectURL: typeof URL.revokeObjectURL === "function"
      ? (url) => URL.revokeObjectURL(url)
      : undefined,
  };
}

/** `retire-plan-[plan-slug]-YYYY-MM-DD.json` derived from the plan name (if named). */
export function suggestedExportFilename(w: Workspace, now: Date = new Date()): string {
  const slug = (w.meta?.name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") ?? "";
  return `retire-plan${slug ? `-${slug}` : ""}-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Downloads the workspace as a versioned PlanFile JSON. Uses the injected
 * createObjectURL when provided (jsdom lacks it); otherwise falls back to a
 * data: URL so the flow still works everywhere.
 */
export function downloadWorkspaceJson(w: Workspace, dom: DomHelpers): { fileName: string; link: string } {
  const text = workspaceToText(w);
  const fileName = suggestedExportFilename(w);
  const link = triggerDownload(text, fileName, dom);
  return { fileName, link };
}

/**
 * Recovery-ladder step 2 ("Download current data as JSON"): raw persisted row,
 * verbatim, NO interpretation — safe even when the row failed validation.
 */
export function downloadRawRowJson(row: unknown, dom: DomHelpers, fileName = "retire-plan-snapshot.json"): void {
  const text = row === undefined ? "{}" : JSON.stringify(row, null, 2);
  triggerDownload(text, fileName, dom);
}

function triggerDownload(text: string, fileName: string, dom: DomHelpers): string {
  let link = "";
  if (dom.createObjectURL) {
    const blob = new Blob([text], { type: "application/json" });
    link = dom.createObjectURL(blob);
  } else {
    link = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
  }
  const anchor = dom.doc.createElement("a");
  anchor.href = link;
  anchor.download = fileName;
  dom.doc.body?.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (dom.revokeObjectURL && !link.startsWith("data:")) dom.revokeObjectURL(link);
  return link;
}

// --- import reading + preview ---------------------------------------------------

/**
 * Reads a chosen File as text. `readText` is injected in tests (jsdom implements
 * FileReader, but a stub keeps failure-order tests deterministic); default
 * resolves via FileReader with a plain-language rejection.
 */
export function readImportFile(
  file: File,
  readText?: (f: File) => Promise<string>,
): Promise<string> {
  if (readText) return readText(file);
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error(`Could not read "${file.name}" from disk.`));
      reader.readAsText(file);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** parse + validate + migrate; errors are the exact array the view renders. */
export function parseImportText(
  text: string,
): ({ ok: true } & Omit<ParseOk, "ok">) | { ok: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      errors: [
        `The file is not valid JSON (${error instanceof Error ? error.message : "parse error"}). ` +
          "Nothing was changed.",
      ],
    };
  }
  return parsePlanFile(json);
}

export interface ImportPreview {
  fileName: string | null;
  planName: string | null;
  /** e.g. "age 45 → 95 (ON)". */
  profile: string;
  scenarioCount: number;
  /** Version the FILE carried (0 = pre-versioning), before migration. */
  importedVersion: number;
  conformsToCurrent: boolean;
  issues: string[];
}

export function previewPlanFile(
  planFile: PlanFile,
  extras: { fileName?: string; importedFrom?: number } = {},
): ImportPreview {
  const entry = planFile.plans[0];
  const profile = entry?.plan?.profile;
  const issues: string[] = [];
  if (!entry) issues.push("The file contains no plans.");
  const importedVersion = extras.importedFrom ?? planFile.schemaVersion;
  if (importedVersion > SCHEMA_VERSION) {
    issues.push("This file is from a newer version of RetirePlan and was not applied.");
  }
  return {
    fileName: extras.fileName ?? null,
    planName: entry ? entry.meta.name : null,
    profile: profile ? `age ${profile.currentAge} → ${profile.endAge} (${profile.province})` : "?",
    scenarioCount: planFile.scenarios.length,
    importedVersion,
    conformsToCurrent: importedVersion <= SCHEMA_VERSION,
    issues,
  };
}

// --- destructive-import / undo hook (consumed by lane A/C PlanView header) ----

export interface ImportCandidate {
  fileName: string;
  sourceText: string;
  preview: ImportPreview;
  workspace: Workspace;
}

export interface ExportImportApi {
  /** Choosen-file entry point; parses and (on success) shows a preview state. */
  importFile: (file: File, readText?: (f: File) => Promise<string>) => Promise<void>;
  /** Replaces the workspace: storage.snapshot("pre-import") BEFORE the swap. */
  confirmReplace: () => Promise<void>;
  cancelPreview: () => void;
  /** Single-level undo: newest backup (created by confirmReplace) or sample. */
  restorePrevious: () => Promise<void>;
  /** Recovery-ladder "start fresh": snapshots the current row BEFORE clearing. */
  startOver: (fresh?: Workspace) => Promise<void>;
  candidate: ImportCandidate | null;
  errors: string[] | null;
  rejectedSourceText: string | null;
  busy: boolean;
  notice: string | null;
  dismissNotice: () => void;
}

export function useExportImport(options: { storage?: StorageProvider } = {}): ExportImportApi {
  const { workspace, dispatch, calendarYear } = useStore();
  const provider = options.storage ?? storage;
  const [candidate, setCandidate] = useState<ImportCandidate | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [rejectedSourceText, setRejectedSourceText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const importFile = useCallback(
    async (file: File, readText?: (f: File) => Promise<string>) => {
      setBusy(true);
      setErrors(null);
      setRejectedSourceText(null);
      try {
        const sourceText = await readImportFile(file, readText);
        const parsed = parseImportText(sourceText);
        if (!parsed.ok) {
          setRejectedSourceText(sourceText);
          setErrors(parsed.errors); // NO backup, NO state change on failure
          setCandidate(null);
          return;
        }
        const currentWorkspace = withCurrentAge(parsed.workspace, calendarYear);
        const currentErrors = validateWorkspace(currentWorkspace);
        if (currentErrors.length > 0) {
          setErrors(currentErrors);
          setRejectedSourceText(sourceText);
          setCandidate(null);
          return;
        }
        setCandidate({
          fileName: file.name,
          sourceText,
          preview: { ...previewPlanFile(parsed.planFile, { fileName: file.name, importedFrom: parsed.migratedFrom }), profile: `age ${currentWorkspace.plan.profile.currentAge} → ${currentWorkspace.plan.profile.endAge} (ON)` },
          workspace: currentWorkspace,
        });
      } catch (error) {
        setErrors([error instanceof Error ? error.message : String(error)]);
        setCandidate(null);
      } finally {
        setBusy(false);
      }
    },
    [calendarYear],
  );

  const confirmReplace = useCallback(async () => {
    if (!candidate || busy) return;
    const resume = suspendAutosave(provider);
    setBusy(true);
    setErrors(null);
    try {
      await provider.runExclusive(async (p) => {
        // Keep the latest valid editing state for undo. A persistence failure
        // aborts replacement; only invalid mid-edit input uses the last good row.
        if (validateWorkspace(workspace).length === 0) await p.save(workspace);
        await p.snapshot("pre-import");
        await p.save(candidate.workspace);
      });
      dispatch({ type: "workspace/loaded", workspace: candidate.workspace });
      resume(candidate.workspace);
      setCandidate(null);
      setNotice(`Imported "${candidate.preview.planName ?? candidate.fileName}".`);
    } catch (error) {
      resume();
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  }, [candidate, busy, dispatch, provider, workspace]);

  const restorePrevious = useCallback(async () => {
    if (busy) return;
    const resume = suspendAutosave(provider);
    setBusy(true);
    setErrors(null);
    try {
      const previous = await provider.runExclusive(async (p) => {
        const rawBackup = await p.restore();
        const backup = rawBackup ? withCurrentAge(rawBackup, calendarYear) : null;
        if (backup) await p.save(backup);
        return backup;
      });
      if (!previous) {
        resume();
        setNotice("No previous snapshot is available.");
        return;
      }
      dispatch({ type: "workspace/loaded", workspace: previous });
      resume(previous);
      setNotice("Previous workspace restored.");
    } catch (error) {
      resume();
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  }, [busy, dispatch, provider, calendarYear]);

  const startOver = useCallback(async (fresh: Workspace = createEmptyWorkspace()) => {
    if (busy) return;
    const resume = suspendAutosave(provider);
    setBusy(true);
    setErrors(null);
    try {
      const currentWorkspace = withCurrentAge(fresh, calendarYear);
      await provider.runExclusive(async (p) => {
        if (validateWorkspace(workspace).length === 0) await p.save(workspace);
        await p.snapshot("start-fresh");
        await p.save(currentWorkspace);
      });
      dispatch({ type: "workspace/loaded", workspace: currentWorkspace });
      resume(currentWorkspace);
      setNotice("Started fresh. The previous data remains available via restore.");
    } catch (error) {
      resume();
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  }, [busy, dispatch, provider, workspace, calendarYear]);

  const cancelPreview = useCallback(() => setCandidate(null), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    importFile,
    confirmReplace,
    cancelPreview,
    restorePrevious,
    startOver,
    candidate,
    errors,
    rejectedSourceText,
    busy,
    notice,
    dismissNotice,
  };
}
