import { useMemo, useState } from "react";
import { HISTORICAL_DATASET } from "@retire-plan/engine";
import { ASSUMPTIONS, TAX_MINIMIZING_STRATEGY_HELP, type AssumptionEntry } from "../../content/assumptions";
import "./assumptionsView.css";

type Topic = {
  id: string;
  title: string;
  summary: string;
  detailIds: readonly string[];
};

const TOPICS: readonly Topic[] = [
  {
    id: "returns",
    title: "Investment returns and paths",
    summary: `Monte Carlo samples annual market returns; it is not a forecast. Historical mode uses non-Canadian U.S. returns measured in USD, with no CAD/USD conversion. The series ends in ${HISTORICAL_DATASET.coverageEnd} and is licensed for noncommercial use. Plan amounts and Canadian/Ontario tax and benefit rules remain as modeled.`,
    detailIds: ["investment-return-floor"],
  },
  {
    id: "income-benefits",
    title: "Income and public benefits",
    summary: "CPP and OAS use the income streams you configure. Benefit switches do not create an entitlement or amount. GIS is modeled only when OAS is included, with simplified eligibility and income timing.",
    detailIds: ["oas-recovery-cap", "gis-employment-exemption", "gis-sequencing", "realized-gains-gis-income"],
  },
  {
    id: "tax-room",
    title: "Taxes and contribution room",
    summary: "Tax results use the engine’s 2026 federal and Ontario tables, indexed for later projection years. Annually announced dollar limits stay at their base-table values; future announcements are not forecast.",
    detailIds: ["tax-indexation-top-brackets", "projection-year-tax-indexation", "rrsp-room-in-year"],
  },
  {
    id: "withdrawals",
    title: "RRSP, RRIF and withdrawals",
    summary: "A mandatory RRIF minimum may exceed spending needs. Surplus follows configured savings rules or remains as cash; it is not automatically reinvested. Extra voluntary RRSP draws stay separate. Tax-aware planning tests bounded policies, requires every modeled year to be fully funded, and retains manual if none qualifies; it cannot guarantee an optimum.",
    detailIds: ["rrif-prescribed-factors", "rrif-minimum-tax", "deficit-gross-up"],
  },
  {
    id: "cash-savings",
    title: "Savings, cash and investment accounts",
    summary: "Named cash accounts earn their configured fixed interest, which is taxable. Unallocated projection cash earns no return. Non-registered withdrawals can realize taxable gains; tax is included in the year’s tax result.",
    detailIds: ["unmatched-policy-steps", "employer-rrsp-match", "projection-cash-reserve", "nonreg-acb", "capital-losses", "nonreg-draw-gains-tax", "mortgage-prepay-step"],
  },
  {
    id: "assets-debt",
    title: "Homes, other assets and debt",
    summary: "Assets can appreciate and be sold in their configured year. Sale costs and recorded gains affect modeled tax. Home sales use the same gains treatment as other assets; the model does not calculate a principal-residence exemption.",
    detailIds: ["plan-assets", "mortgage-rate-convention", "negative-amortization", "final-mortgage-year"],
  },
  {
    id: "tax-planning",
    title: "How tax-aware withdrawals are planned",
    summary: "The objective is total income tax through your end age; estate and later taxes are excluded. Planning uses deterministic assumptions once, then replays the same policy in Monte Carlo and historical modes, where results can differ.",
    detailIds: [],
  },
];

const categoryLabel: Record<AssumptionEntry["category"], string> = {
  exact: "Model rule",
  approximation: "Simplified",
  deferred: "Not modeled",
};

const MONTE_CARLO_METHOD = "Each run draws independent annual normal returns for equity, bonds and market cash around the scenario’s return assumptions. Standard deviations are percentage-point amounts. The configured 32-bit seed reproduces the same paths; a generated return cannot lose more than the full value of an asset. The success rate is the share of simulated paths the year stepper marks successful. Final-wealth percentiles describe separate runs; charts and year details show one actual run selected near the median, not a blended path.";

function HistoricalDetails({ open = false }: { open?: boolean }) {
  return (
    <details className="assumptions-details" open={open}>
      <summary>Historical data source and licensing</summary>
      <div className="assumptions-detail-copy">
        <p>
          {HISTORICAL_DATASET.name}, release {HISTORICAL_DATASET.release}, covers {HISTORICAL_DATASET.coverageStart}–{HISTORICAL_DATASET.coverageEnd}. Return rates are measured in nominal USD and used as a U.S.-market proxy. No CAD/USD conversion or currency-return effects are modeled. Plan amounts and Canadian/Ontario tax and benefit assumptions remain in the plan’s existing model; taxes and benefits are not historical replays. Windows cannot reach the present because the data ends in {HISTORICAL_DATASET.coverageEnd}.
        </p>
        <p>
          The data is licensed {HISTORICAL_DATASET.license}; use is noncommercial. Redistribution and derivatives require attribution and the same license.
        </p>
        <p>
          <a href="https://www.macrohistory.net/database/" target="_blank" rel="noreferrer">JST Macrohistory Database source and documentation</a>
          {" · "}
          <a href={HISTORICAL_DATASET.url} target="_blank" rel="noreferrer">Source workbook</a>
        </p>
        <ul>
          <li>Òscar Jordà, Moritz Schularick, and Alan M. Taylor. 2017. “Macrofinancial History and the New Business Cycle Facts.” <em>NBER Macroeconomics Annual 2016</em>, volume 31, edited by Martin Eichenbaum and Jonathan A. Parker. Chicago: University of Chicago Press.</li>
          <li>Òscar Jordà, Katharina Knoll, Dmitry Kuvshinov, Moritz Schularick, and Alan M. Taylor. 2019. “The Rate of Return on Everything, 1870–2015.” <em>Quarterly Journal of Economics</em>, 134(3), 1225–1298.</li>
        </ul>
      </div>
    </details>
  );
}

function MonteCarloDetails({ open = false }: { open?: boolean }) {
  return (
    <details className="assumptions-details" open={open}>
      <summary>Monte Carlo method</summary>
      <div className="assumptions-detail-copy">
        <p>{MONTE_CARLO_METHOD}</p>
      </div>
    </details>
  );
}

export function AssumptionsView() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const topics = useMemo(() => TOPICS.map((topic) => {
    const entries = topic.detailIds
      .map((id) => ASSUMPTIONS.find((entry) => entry.id === id))
      .filter((entry): entry is AssumptionEntry => Boolean(entry));
    const matchingEntries = normalizedQuery
      ? entries.filter((entry) => `${entry.id} ${entry.title} ${entry.body} ${entry.since} ${categoryLabel[entry.category]}`.toLowerCase().includes(normalizedQuery))
      : entries;
    const searchable = `${topic.title} ${topic.summary} ${entries.map((entry) => `${entry.title} ${entry.body}`).join(" ")} ${topic.id === "tax-planning" ? TAX_MINIMIZING_STRATEGY_HELP : ""} ${topic.id === "returns" ? `${MONTE_CARLO_METHOD} jst macrohistory historical dataset licensed noncommercial source workbook citation nominal usd fx currency coverage` : ""}`.toLowerCase();
    return { ...topic, entries: matchingEntries, matches: !normalizedQuery || searchable.includes(normalizedQuery) || matchingEntries.length > 0 };
  }).filter((topic) => topic.matches), [normalizedQuery]);

  const historicalMatches = !normalizedQuery || /histor|jst|source|license|usd|currency|u\.s\./i.test(normalizedQuery);
  const plannerDetails = TAX_MINIMIZING_STRATEGY_HELP;

  return (
    <section className="assumptions-page" aria-labelledby="assumptions-title">
      <header className="assumptions-intro">
        <p className="assumptions-eyebrow">MODEL GUIDE</p>
        <h2 id="assumptions-title">What the projection includes</h2>
        <p>These results show how your plan behaves under the assumptions below. They are planning illustrations, not forecasts. Expand a topic for the engine rules and source details.</p>
      </header>

      <div className="assumptions-search">
        <label htmlFor="assumptions-filter">Find a model detail</label>
        <input
          id="assumptions-filter"
          type="search"
          aria-label="Filter assumptions"
          value={query}
          placeholder="Try RRIF, GIS, historical returns…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {normalizedQuery ? <p className="assumptions-result-count" role="status">{topics.length} topic{topics.length === 1 ? "" : "s"} match “{query}”.{topics.length === 0 ? " Try another term." : ""}</p> : null}

      <div className="assumptions-topics">
        {topics.map((topic) => (
          <article className="assumptions-topic" key={topic.id}>
            <h3>{topic.title}</h3>
            <p>{topic.summary}</p>
            {topic.id === "tax-planning" ? (
              <details className="assumptions-details" open={Boolean(normalizedQuery)}>
                <summary>How the planner works</summary>
                <div className="assumptions-detail-copy">
                  <p>{plannerDetails}</p>
                  <p>Only tested policies that fully fund every modeled year are eligible. If none qualifies, the manual policy is retained and the result says no feasible tested policy was found. The comparison is not a guarantee for Monte Carlo or historical outcomes.</p>
                </div>
              </details>
            ) : null}
            {topic.entries.length > 0 ? (
              <details className="assumptions-details" open={Boolean(normalizedQuery)}>
                <summary>Detailed rules ({topic.entries.length})</summary>
                <ul className="assumptions-rule-list">
                  {topic.entries.map((entry) => (
                    <li key={entry.id} data-assumption-id={entry.id}>
                      <div className="assumptions-rule-heading">
                        <strong>{entry.title}</strong>
                        <span className={`assumptions-status assumptions-status--${entry.category}`}>{categoryLabel[entry.category]}</span>
                      </div>
                      <p>{entry.body}</p>
                      <span className="assumptions-since">Model version: {entry.since}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {topic.id === "returns" ? <>
              <MonteCarloDetails open={Boolean(normalizedQuery && /monte|seed|standard deviation|median|representative|percentile|success probability/i.test(normalizedQuery))} />
              {historicalMatches ? <HistoricalDetails open={Boolean(normalizedQuery)} /> : null}
            </> : null}
          </article>
        ))}
      </div>
      <p className="assumptions-footer">Tax tables: ca-2026 · @retire-plan/engine</p>
    </section>
  );
}
