import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "../../store/api";
import { PROJECTION_CHARTS } from "./DashboardSection";
import { columns, sanitizeHiddenColumns } from "./ProjectionTable";
import { sanitizeHiddenIds } from "./hiddenIds";

function SettingsGear({ label }: { label: string }) {
  return (
    <summary aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <g fill="currentColor">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <rect key={angle} x="11" y="2.5" width="2" height="5" rx="1" transform={`rotate(${angle} 12 12)`} />
          ))}
          <circle cx="12" cy="12" r="5.2" />
        </g>
        <circle cx="12" cy="12" r="2.2" fill="#fff" />
      </svg>
    </summary>
  );
}

export function ProjectionChartSettings() {
  const { workspace, dispatch } = useWorkspace();
  const hiddenCharts = sanitizeHiddenIds(
    workspace.hiddenProjectionCharts,
    PROJECTION_CHARTS.map(({ id }) => id),
  );
  const toggleChart = (id: string) => {
    const current = hiddenCharts ?? [];
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    dispatch({ type: "projection/setHiddenCharts", hiddenChartIds: next });
  };

  return (
    <div className="projection-panel-toolbar no-print">
      <details className="projection-settings projection-chart-settings">
        <SettingsGear label="Chart settings" />
        <div className="projection-settings-menu">
          <p className="settings-heading">Dashboard charts</p>
          {PROJECTION_CHARTS.map((chart) => (
            <label key={chart.id}>
              <input
                type="checkbox"
                checked={!(hiddenCharts ?? []).includes(chart.id)}
                onChange={() => toggleChart(chart.id)}
              />{" "}
              {chart.title}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

export function ProjectionTableSection({ children }: { children: (hiddenIds?: Set<string>) => ReactNode }) {
  const { workspace, dispatch } = useWorkspace();
  const allColumns = columns();
  const selectableIds = allColumns.slice(1).map((col) => col.id);
  const hiddenList = sanitizeHiddenColumns(workspace.hiddenProjectionColumns, selectableIds);
  const hiddenIds = hiddenList === null ? undefined : new Set(hiddenList);
  // Bulk column checkbox: DOM `indeterminate` is the native accessible "mixed"
  // state — set whenever a partial (non-empty, non-full) set of columns is
  // hidden. Recomputed every render (no dependency array) so it tracks the
  // workspace state without extra effects dependencies.
  const bulkColumnsRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (bulkColumnsRef.current) {
      const hiddenCount = (hiddenList ?? []).length;
      bulkColumnsRef.current.indeterminate = hiddenCount > 0 && hiddenCount < selectableIds.length;
    }
  });
  const columnPickerGroups: { group: string; items: { id: string; label: string }[] }[] = [];
  const pickerByName = new Map<string, { group: string; items: { id: string; label: string }[] }>();
  for (const col of allColumns.slice(1)) {
    const name = col.group ?? "Other";
    let entry = pickerByName.get(name);
    if (!entry) {
      entry = { group: name, items: [] };
      pickerByName.set(name, entry);
      columnPickerGroups.push(entry);
    }
    entry.items.push({ id: col.id, label: col.label });
  }
  const toggleColumn = (id: string) => {
    const current = hiddenList ?? [];
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    dispatch({ type: "projection/setHiddenColumns", hiddenColumnIds: next });
  };
  return (
    <>
      <div className="projection-panel-toolbar projection-table-toolbar">
        <h3>Year-by-year results</h3>
        <details className="projection-settings projection-table-settings no-print">
          <SettingsGear label="Table settings" />
          <div className="projection-settings-menu">
            <p className="settings-heading">Table columns</p>
            {/* ONE bulk action for TABLE columns only (charts unaffected): a native
                  checkbox — checked when every selectable column is visible, unchecked
                  when none is, DOM-`indeterminate` (announced as "mixed") in any
                  partial state. Clicking in a partial or none state selects all;
                  clicking while checked unselects all. Pinned Age/calendar-year and
                  Audit columns are never selectable, so they always remain. */}
            <div className="bulk-columns">
              <label>
                <input
                  ref={bulkColumnsRef}
                  type="checkbox"
                  aria-label="Select all columns"
                  checked={(hiddenList ?? []).length === 0}
                  onChange={() => {
                    const allVisible = (hiddenList ?? []).length === 0;
                    dispatch({
                      type: "projection/setHiddenColumns",
                      hiddenColumnIds: allVisible ? selectableIds : null,
                    });
                  }}
                />{" "}
                Select all columns
              </label>{" "}
              <span className="bulk-columns-count">
                ({selectableIds.length - (hiddenList ?? []).length} of {selectableIds.length} shown)
              </span>
            </div>
            {columnPickerGroups.map(({ group, items }) => (
              <div key={group} className="settings-group">
                <p className="settings-group-name">{group}</p>
                {items.map((col) => (
                  <label key={col.id}>
                    <input type="checkbox" checked={!hiddenIds?.has(col.id)} onChange={() => toggleColumn(col.id)} />{" "}
                    {col.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </details>
      </div>
      {children(hiddenIds)}
    </>
  );
}
