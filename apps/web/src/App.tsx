import { useEffect, useState } from "react";
import { ROUTES, RouteContent, type Route } from "./routes";
import { StoreProvider, useWorkspace, type Workspace } from "./store/api";
import { storage, useAutosave, type StorageProvider, type RecoveryOutcome } from "./storage";
import { makeSampleWorkspace } from "./data/samplePlan";
import { ambientDom, downloadRawRowJson, downloadWorkspaceJson, useExportImport } from "./content/planFileUi";
import { BaseScenarioSettings } from "./components/BaseScenarioSettings";
import { withCurrentAge } from "./domain/age";

function FileControls({ provider }: { provider: StorageProvider }) {
  const { workspace } = useWorkspace();
  const file = useExportImport({ storage: provider });
  const [error, setError] = useState<string | null>(null);
  const perform = (operation: () => Promise<void>) => { void operation().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))); };
  const candidate = file.candidate;
  return <section className="panel file-controls" aria-label="Workspace files">
    <div className="toolbar"><strong>{workspace.meta?.name ?? "Untitled plan"}</strong>
      <button type="button" onClick={() => { const dom = ambientDom(); if (dom) downloadWorkspaceJson(workspace, dom); }}>Export JSON</button>
      <label className="file-input-label">Import JSON <input type="file" accept=".json,application/json" disabled={file.busy} onChange={event => { const chosen = event.currentTarget.files?.[0]; if (chosen) perform(() => file.importFile(chosen)); event.currentTarget.value = ""; }} /></label>
    </div>
    {(error || file.errors) && <div role="alert">{error}{file.errors?.map(message => <p key={message}>{message}</p>)}</div>}
    {file.rejectedSourceText !== null && <details><summary>Inspect original JSON</summary>
      <textarea aria-label="JSON for inspection" readOnly rows={6} value={file.rejectedSourceText} />
      <button type="button" onClick={() => {
        if (!navigator.clipboard) { setError("Select the JSON text above and copy it with your keyboard."); return; }
        void navigator.clipboard.writeText(file.rejectedSourceText ?? "").then(() => setError(null)).catch(() => setError("Select the JSON text above and copy it with your keyboard."));
      }}>Copy JSON for inspection</button>
    </details>}
    {candidate && <div className="import-preview" role="region" aria-label="Import preview">
      <h2>Review import</h2><p>{candidate.fileName} · {candidate.preview.planName} · {candidate.preview.profile} · {candidate.preview.scenarioCount} scenarios · schema {candidate.preview.importedVersion}</p>
      <p>Validated. Replace “{workspace.meta?.name ?? "Untitled plan"}” (updated {workspace.meta?.updatedAt ?? "not saved"}; {workspace.scenarios.length} scenarios)? A backup will be saved first.</p>
      <div className="toolbar"><button type="button" disabled={file.busy} onClick={() => perform(file.confirmReplace)}>Replace workspace</button><button type="button" disabled={file.busy} onClick={file.cancelPreview}>Cancel</button></div>
    </div>}
    {file.notice && <div className="banner" role="status">{file.notice} <button type="button" disabled={file.busy} onClick={() => perform(file.restorePrevious)}>Restore previous</button><button type="button" onClick={file.dismissNotice}>Dismiss</button></div>}
  </section>;
}

function AutosaveStatus({ provider }: { provider: StorageProvider }) {
  const { workspace } = useWorkspace();
  const autosave = useAutosave(workspace, { storage: provider });
  return <p className="save-status" aria-label="Workspace save status" role="status" aria-live="polite">{autosave.error ? `Could not save locally: ${autosave.error}` : autosave.isCurrentSaved ? "Saved on this device" : autosave.status === "saving" ? "Saving locally…" : "Workspace changes waiting for local save…"}</p>;
}

export function AppShell({ provider, sample = false }: { provider?: StorageProvider; sample?: boolean }) {
  const { workspace, activeRunId, editNotice } = useWorkspace();
  const [route, setRoute] = useState<Route>("Plan");
  useEffect(() => { if (activeRunId !== null) setRoute("Projection"); }, [activeRunId]);
  useEffect(() => {
    if (route !== "Projection" || activeRunId === null) return;
    const target = document.getElementById("projection-year-table") ?? document.getElementById("projection-results");
    target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    target?.focus({ preventScroll: true });
  }, [route, activeRunId]);
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="app-header">
      <div><span className="eyebrow">PRIVATE · ONTARIO · CAD</span><div className="brand">RetirePlan</div></div>
      <p>Plan today. See the years ahead.</p>
      <span className="local-badge">Local data only</span>
    </header>
    <nav className="main-nav" aria-label="Main views">{ROUTES.map(name => <button key={name} type="button" aria-current={name === route ? "page" : undefined} onClick={() => setRoute(name)}>{name}</button>)}</nav>
    <main id="main">
      {sample && workspace.meta?.name === "Sample plan" && <div className="banner">Sample plan — edit the example or import your own JSON workspace.</div>}
      {editNotice && <p className="edit-notice" role="status">{editNotice}</p>}
      {provider && <AutosaveStatus provider={provider} />}
      {route === "Plan" && provider && <FileControls provider={provider} />}
      {route === "Plan" && <BaseScenarioSettings />}
      <RouteContent route={route} />
    </main>
    <footer className="app-footer">Ontario planning assumptions · 2026 tax tables · Deterministic projections</footer>
  </div>;
}

type BootState = { kind: "loading" } | { kind: "ready"; workspace: Workspace; sample: boolean; persist: boolean } | RecoveryOutcome | { kind: "error"; message: string };
export default function App({ storageProvider = storage }: { storageProvider?: StorageProvider }) {
  const [boot, setBoot] = useState<BootState>({ kind: "loading" });
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void storageProvider.load().then(outcome => {
      if (!active) return;
      if (outcome.kind === "recoverable") setBoot(outcome);
      else setBoot({ kind: "ready", workspace: outcome.kind === "fresh" ? makeSampleWorkspace() : outcome.workspace, sample: outcome.kind === "fresh", persist: true });
    }).catch(error => { if (active) setBoot({ kind: "error", message: error instanceof Error ? error.message : String(error) }); });
    return () => { active = false; };
  }, [storageProvider]);
  async function recover(workspace: Workspace) {
    try {
      const currentWorkspace = withCurrentAge(workspace, new Date().getFullYear());
      await storageProvider.runExclusive(async provider => {
        await provider.snapshot("pre-recovery");
        await provider.save(currentWorkspace);
      });
      setBoot({ kind: "ready", workspace: currentWorkspace, sample: currentWorkspace.meta?.name === "Sample plan", persist: true });
    } catch (error) { setRecoveryError(error instanceof Error ? error.message : String(error)); }
  }
  if (boot.kind === "ready") return <StoreProvider initialWorkspace={boot.workspace}><AppShell provider={boot.persist ? storageProvider : undefined} sample={boot.sample} /></StoreProvider>;
  if (boot.kind === "loading") return <main className="app-shell"><p role="status">Opening your local workspace…</p></main>;
  return <main className="app-shell"><section className="panel"><h1>Open your workspace</h1>
    <p role="alert">{boot.kind === "error" ? boot.message : "The saved workspace could not be read. Your current data has been kept."}</p>
    {recoveryError && <p role="alert">{recoveryError}</p>}
    <div className="toolbar">
      {boot.kind === "recoverable" && boot.offered && <button onClick={() => void recover(boot.offered!)}>Restore previous workspace</button>}
      {boot.kind === "recoverable" && <button onClick={() => {
        void storageProvider.readRawRow().then(row => { const dom = ambientDom(); if (dom) downloadRawRowJson(row, dom); }).catch(error => setRecoveryError(String(error)));
      }}>Download current data as JSON</button>}
      <button onClick={() => void recover(makeSampleWorkspace())}>Start with the sample plan</button>
      <button onClick={() => setBoot({ kind: "ready", workspace: makeSampleWorkspace(), sample: true, persist: false })}>Continue without local saving</button>
    </div>
  </section></main>;
}
