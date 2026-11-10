interface FailSummary {
  success: boolean;
  failureAge?: number;
  worstShortfallAge?: number;
}

/**
 * Run-out banner (first-class outcome, spec §7): names the failure age and the worst
 * shortfall age, and anchors the browser to the failing year's table row.
 */
export function FailBanner({ summary }: { summary: FailSummary }) {
  const failureAge = summary.failureAge;
  const worstAge = summary.worstShortfallAge;
  const jump = () => {
    if (failureAge === undefined) return;
    const row = document.getElementById(`projection-year-${failureAge}`);
    if (row && typeof (row as { scrollIntoView?: () => void }).scrollIntoView === "function") {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  return (
    <p role="status" className="fail-banner" onClick={jump}>
      <strong>
        Plan fails at age {failureAge ?? "unknown"}
      </strong>
      {worstAge !== undefined && <> — worst shortfall at age {worstAge}</>}
      {" "}
      <span className="hint">The remaining years still run (run-out is a first-class outcome); click to jump to the failing year.</span>
    </p>
  );
}
