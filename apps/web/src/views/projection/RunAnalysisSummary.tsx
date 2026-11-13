import { HISTORICAL_DATASET } from "@retire-plan/engine";
import type { RunRecord } from "../../domain/types";
import { fmtMoney } from "./fmt";
import "./runAnalysis.css";

export function RunAnalysisSummary({ run }: { run: RunRecord }) {
  const planSummary = run.result.withdrawalPlan ? <WithdrawalPlanSummary run={run} /> : null;
  if (!run.analysis) return planSummary;
  const { successRate, percentileNetWorth } = run.analysis;
  if (run.analysis.mode === "montecarlo") {
    return <>{planSummary}<aside className="run-analysis" aria-label="Monte Carlo results">
      <h3>Monte Carlo ensemble</h3>
      <p><strong>{(successRate * 100).toFixed(1)}% success probability</strong> across {run.scenario.mcConfig?.runs ?? "configured"} seeded runs.</p>
      <dl>
        <dt>Final net worth · 10th percentile</dt><dd>{fmtMoney(percentileNetWorth.p10)}</dd>
        <dt>Median final net worth</dt><dd>{fmtMoney(percentileNetWorth.p50)}</dd>
        <dt>Final net worth · 90th percentile</dt><dd>{fmtMoney(percentileNetWorth.p90)}</dd>
      </dl>
      <p className="hint">Charts and year details show coherent seeded run {run.analysis.representativeRun}, selected nearest the median final net worth. Percentiles summarize separate runs and are not yearly paths.</p>
    </aside></>;
  }
  return <>{planSummary}<aside className="run-analysis" aria-label="Historical results">
    <h3>Historical rolling-window results</h3>
    <p><strong>{(successRate * 100).toFixed(1)}% success probability</strong> across {run.analysis.windowCount} complete rolling windows, starting from source year {run.analysis.firstWindowStartYear} through {run.analysis.latestWindowStartYear}.</p>
    <dl>
      <dt>Final net worth · 10th percentile</dt><dd>{fmtMoney(percentileNetWorth.p10)}</dd>
      <dt>Median final net worth</dt><dd>{fmtMoney(percentileNetWorth.p50)}</dd>
      <dt>Final net worth · 90th percentile</dt><dd>{fmtMoney(percentileNetWorth.p90)}</dd>
      <dt>Representative return-source years</dt><dd>{run.analysis.representativeStartYear}–{run.analysis.representativeEndYear}</dd>
    </dl>
    <p className="hint">The year table shows one actual window chosen nearest the median final net worth. Percentiles summarize separate windows, not synthetic yearly paths. Table calendar years are your household projection years; source years are historical return observations.</p>
    <p className="hint">{HISTORICAL_DATASET.name}, release {HISTORICAL_DATASET.release} · {HISTORICAL_DATASET.country} annual return rates measured in nominal USD. These U.S. returns are applied as a proxy; no CAD/USD conversion or currency-return effects are modeled. Existing Canadian/Ontario tax and benefit assumptions remain in effect; taxes and benefits are not historical replays.</p>
    <details className="historical-citations">
      <summary>Citations &amp; license</summary>
      <p>Source coverage {HISTORICAL_DATASET.coverageStart}–{HISTORICAL_DATASET.coverageEnd}; returns are nominal and measured in local USD. No FX conversion is applied. Database consulted 2026-11-12/13; bundled extraction: {HISTORICAL_DATASET.extractedAt}. Windows cannot reach the present because the series ends in {HISTORICAL_DATASET.coverageEnd}.</p>
      <p>License: {HISTORICAL_DATASET.license}. Noncommercial use only; redistributed data or derivatives must include attribution and use the same license.</p>
      <p><a href="https://www.macrohistory.net/database/" target="_blank" rel="noreferrer">JST Macrohistory Database source and documentation</a> · <a href={HISTORICAL_DATASET.url} target="_blank" rel="noreferrer">Bundled source workbook</a></p>
      <ul>
        <li>Òscar Jordà, Moritz Schularick, and Alan M. Taylor. 2017. “Macrofinancial History and the New Business Cycle Facts.” <em>NBER Macroeconomics Annual 2016</em>, volume 31, edited by Martin Eichenbaum and Jonathan A. Parker. Chicago: University of Chicago Press.</li>
        <li>Òscar Jordà, Katharina Knoll, Dmitry Kuvshinov, Moritz Schularick, and Alan M. Taylor. 2019. “The Rate of Return on Everything, 1870–2015.” <em>Quarterly Journal of Economics</em>, 134(3), 1225–1298.</li>
      </ul>
    </details>
  </aside></>;
}

function WithdrawalPlanSummary({ run }: { run: RunRecord }) {
  const metadata = run.result.withdrawalPlan!;
  const { comparison } = metadata;
  return <aside className="run-analysis withdrawal-plan-summary" aria-label="Tax strategy planning comparison">
    <h3>Tax strategy planning comparison</h3>
    <p>{metadata.planningBasis}</p>
    <dl>
      <dt>Total projected income tax · manual order</dt><dd>{fmtMoney(comparison.manualTotalTax)}</dd>
      <dt>Total projected income tax · selected plan</dt><dd>{fmtMoney(comparison.optimizedTotalTax)}</dd>
      <dt>Final net worth · manual order</dt><dd>{fmtMoney(comparison.manualFinalNetWorth)}</dd>
      <dt>Final net worth · selected plan</dt><dd>{fmtMoney(comparison.optimizedFinalNetWorth)}</dd>
      <dt>Modeled GIS · manual / selected plan</dt><dd>{fmtMoney(comparison.manualGisTotal)} / {fmtMoney(comparison.optimizedGisTotal)}</dd>
      <dt>Fully funded across all modeled years · manual / selected plan</dt><dd>{comparison.manualSuccess ? "Yes" : "No"} / {comparison.optimizedSuccess ? "Yes" : "No"}</dd>
    </dl>
    <p><strong>Selection rule:</strong> {comparison.selectionRule}</p>
    {metadata.status === "optimized" && !comparison.manualSuccess && comparison.optimizedSuccess && <p className="hint">The manual-order baseline had a shortfall or did not meet retirement success, while the selected policy fully funded every modeled year. Its tax may be higher; the totals reflect different feasibility outcomes and are not an apples-to-apples tax-saving comparison.</p>}
    {metadata.status === "manual-retained" && <p className="hint">Manual withdrawal order retained: no tested policy that fully funded every modeled year strictly reduced total projected tax versus this fully funded baseline.</p>}
    {metadata.status === "no-feasible-policy" && <p className="hint">No tested policy met both retirement success and the no-shortfall requirement in every modeled year. Manual withdrawal order was retained. Review the annual shortfalls shown in the projection.</p>}
    {metadata.plannedWithdrawals.length > 0
      ? <p><strong>Planned proactive RRSP draws:</strong> {metadata.plannedWithdrawals.map(item => `age ${item.age}: ${fmtMoney(item.netRrspDraw)}`).join(" · ")}</p>
      : <p>No proactive RRSP draws were selected; required minimums and other funding rules still apply.</p>}
    {run.scenario.simMode === "deterministic"
      ? <p className="hint">This is a planning comparison under one deterministic assumption set. The bounded heuristic does not guarantee a global optimum.</p>
      : <p className="hint">This fixed policy was planned once from deterministic assumptions, then reused across {run.scenario.simMode === "montecarlo" ? "Monte Carlo paths" : "historical windows"}. Tax, net worth, and benefits can differ on actual paths; no pathwise or global-optimum guarantee is implied.</p>}
  </aside>;
}
