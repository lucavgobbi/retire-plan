import { useMemo, useState } from "react";
import { useWorkspace } from "../../store/api";
import { ScenarioEditorForm } from "./ScenarioEditorForm";
import { ScenarioList } from "./ScenarioList";
import type { ScenarioDelta } from "../../domain/types";
import "./scenarios.css";

/**
 * Default (zero-prop) scenarios view: manage ScenarioDeltas (app-layer deltas on the
 * Plan-view working scenario) and run any of them. Engine `Scenario` objects are
 * resolved at run time by resolveScenario (domain/scenario.ts) inside the store.
 */
export function ScenariosView() {
  const workspace = useWorkspace();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const editing = useMemo<ScenarioDelta | null>(() => {
    if (creating) return null;
    return workspace.workspace.scenarios.find((delta) => delta.id === editingId) ?? null;
  }, [creating, editingId, workspace.workspace.scenarios]);

  const showEditor = creating || editing !== null;

  return (
    <section aria-label="Scenarios" className="scenarios-view">
      <header className="no-print">
        <h2>Scenarios</h2>
        <button type="button" onClick={() => { setEditingId(null); setCreating(true); }}>
          New scenario
        </button>
      </header>

      {workspace.workspace.scenarios.length === 0 && !showEditor && (
        <p className="hint empty-state">
          No scenarios yet. A scenario is a set of overrides on the plan's working scenario
          (retirement age, return assumptions, withdrawal order) — the engine-ready
          Scenario is resolved when the run is dispatched.
        </p>
      )}

      {showEditor ? (
        <ScenarioEditorForm
          key={editing?.id ?? "new"}
          delta={editing}
          onDone={() => { setCreating(false); setEditingId(null); }}
        />
      ) : null}

      <ScenarioList
        deltas={workspace.workspace.scenarios}
        editingId={editingId}
        onEdit={(id) => { setCreating(false); setEditingId(id); }}
      />
    </section>
  );
}
