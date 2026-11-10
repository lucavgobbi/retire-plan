import { useMemo, useState } from "react";
import type { RunRecord } from "../../domain/types";
import { useRuns } from "../../store/api";
import { fmtMoney } from "../projection/fmt";
import { CompareChart } from "./CompareChart";
import { CompareTable } from "./CompareTable";
import { computeComparison } from "./compare";
import "./compare.css";

/**
 * Default (zero-prop) compare view: checkbox-select stored runs (base + deltas),
 * pick a baseline, side-by-side summary table with Δ columns + overlaid net worth chart.
 * Deltas are computed client-side and purely (computeComparison).
 */
export function CompareView() {
  const runs = useRuns();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);

  const selected = useMemo<RunRecord[]>(
    () => runs.filter((run) => selectedIds.includes(run.id)),
    [runs, selectedIds],
  );
  const rows = useMemo(
    () => (selected.length === 0 ? [] : computeComparison(selected, baselineId)),
    [selected, baselineId],
  );

  if (runs.length === 0) {
    return (
      <section aria-label="Compare" className="compare-view">
        <h2>Compare</h2>
        <p className="hint empty-state">
          No runs stored yet. Run the base projection or a scenario, then compare here.
        </p>
      </section>
    );
  }

  const toggle = (id: string) => {
    setSelectedIds((current) => {
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      if (baselineId !== null && !next.includes(baselineId)) setBaselineId(null);
      return next;
    });
  };

  return (
    <section aria-label="Compare" className="compare-view">
      <h2>Compare</h2>
      <p className="hint">Select stored runs (snapshots — later plan edits do not change them).</p>
      <ul className="compare-run-list">
        {runs.map((run) => (
          <li key={run.id}>
            <label>
              <input
                type="checkbox"
                checked={selectedIds.includes(run.id)}
                onChange={() => toggle(run.id)}
                aria-label={`Select run ${labelFor(run)}`}
              />
              {labelFor(run)}
              <span className="hint">
                {" "}
                {new Date(run.createdAt).toLocaleString()} · {run.scenario.simMode}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {rows.length > 0 && (
        <>
          <label className="compare-baseline">
            <span>Baseline for Δ columns</span>
            <select
              aria-label="Baseline"
              value={baselineId ?? ""}
              onChange={(event) => setBaselineId(event.target.value === "" ? null : event.target.value)}
            >
              <option value="">— none —</option>
              {selected.map((run) => (
                <option key={run.id} value={run.id}>
                  {labelFor(run)}
                </option>
              ))}
            </select>
          </label>
          <CompareTable rows={rows} />
          {selected.length >= 2 && <CompareChart rows={rows} />}
        </>
      )}
      {rows.length === 0 && (
        <p className="hint empty-state">
          Check at least one run to build the side-by-side comparison.
        </p>
      )}
    </section>
  );
}

function labelFor(run: RunRecord): string {
  const name = run.scenario.name || (run.scenarioId === null ? "Base scenario" : run.scenarioId);
  return `${name} (${fmtMoney(run.result.summary.finalNetWorth)})`;
}
