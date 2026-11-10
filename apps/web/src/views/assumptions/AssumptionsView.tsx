import { useMemo, useState } from "react";
import { ASSUMPTIONS, type AssumptionEntry } from "../../content/assumptions";

/**
 * Default (zero-prop) assumptions & simplifications view.
 * Content mirrors docs/assumptions.md (see the registry header comment); entries are
 * grouped exact / approximated / deferred, with search-as-you-type.
 */
export function AssumptionsView() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ASSUMPTIONS;
    return ASSUMPTIONS.filter((entry) =>
      `${entry.id} ${entry.title} ${entry.body}`.toLowerCase().includes(q),
    );
  }, [query]);

  const groups: { category: AssumptionEntry["category"]; heading: string }[] = [
    { category: "exact", heading: "Exact — official formulas and data" },
    { category: "approximation", heading: "Approximated — deliberate simplifications" },
    { category: "deferred", heading: "Deferred — queued for later phases" },
  ];

  return (
    <section aria-label="Assumptions and simplifications">
      <h2>Assumptions &amp; simplifications</h2>
      <p className="hint">
        Every simplification below is deliberate and pinned by engine tests. Source of truth:
        docs/assumptions.md.
      </p>
      <label>
        <span>Filter</span>
        <input
          type="search"
          aria-label="Filter assumptions"
          value={query}
          placeholder="Search assumptions…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {groups.map((group) => {
        const entries = filtered.filter((entry) => entry.category === group.category);
        if (entries.length === 0) return null;
        return (
          <section key={group.category} aria-label={group.heading}>
            <h3>{group.heading}</h3>
            <ul className="assumptions-list">
              {entries.map((entry) => (
                <li key={entry.id} data-assumption-id={entry.id}>
                  <strong>{entry.title}</strong>{" "}
                  <span className="hint">({entry.since})</span>
                  <p>{entry.body}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="hint version-footer">Tax tables: ca-2026 (@retire-plan/engine data)</p>
    </section>
  );
}
