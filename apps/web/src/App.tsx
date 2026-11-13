import { useEffect, useRef, useState } from "react";
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
  if (!autosave.error) return null;
  return <div className="save-status save-error" aria-label="Workspace save error" role="alert">Could not save locally: {autosave.error} <button type="button" onClick={autosave.saveNow}>Retry save</button></div>;
}

/** Modal settings dialog: plan file controls plus base projection settings. */
function SettingsDialog({ provider, onClose }: { provider?: StorageProvider; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="dialog-overlay" onClick={onClose}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1} className="dialog-panel" onClick={event => event.stopPropagation()}>
      <div className="dialog-header">
        <h2>Settings</h2>
        <button type="button" aria-label="Close settings" onClick={onClose}>✕</button>
      </div>
      {provider && <FileControls provider={provider} />}
      <BaseScenarioSettings />
    </div>
  </div>;
}

export function AppShell({ provider, sample = false }: { provider?: StorageProvider; sample?: boolean }) {
  const { workspace, activeRunId, editNotice } = useWorkspace();
  const [route, setRoute] = useState<Route>("Plan");
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      <span className="local-badge">Local data only</span>
      <button type="button" className="settings-button" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      </button>
    </header>
    {settingsOpen && <SettingsDialog provider={provider} onClose={() => setSettingsOpen(false)} />}
    <nav className="main-nav" aria-label="Main views">{ROUTES.map(name => <button key={name} type="button" aria-current={name === route ? "page" : undefined} onClick={() => setRoute(name)}>{name}</button>)}</nav>
    <main id="main">
      {sample && workspace.meta?.name === "Sample plan" && <div className="banner">Sample plan — edit the example or import your own JSON workspace.</div>}
      {editNotice && <p className="edit-notice" role="status">{editNotice}</p>}
      {provider && <AutosaveStatus provider={provider} />}
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
