import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../domain/types";
import { RunAnalysisSummary } from "./RunAnalysisSummary";

const run: RunRecord = {
  id: "mc-run", planId: "p", scenarioId: "mc", createdAt: "2026-01-01T00:00:00Z",
  scenario: { id: "mc", name: "MC", simMode: "montecarlo", retirementAge: 65, returnAssumptions: { equity: 0.05, bond: 0.02, cash: 0 }, withdrawalOrder: ["tfsa", "nonreg", "rrsp"], mcConfig: { runs: 1_000, seed: 12, stdDev: { equity: 0.18, bond: 0.06, cash: 0.02 } } },
  result: { years: [], summary: { success: true, finalNetWorth: 20 } },
  analysis: { mode: "montecarlo", successRate: 0.73, percentileNetWorth: { p10: 10_000, p50: 20_000, p90: 30_000 }, representativeRun: 411 },
};

describe("RunAnalysisSummary", () => {
  it("shows ensemble metrics and clearly identifies the representative path", () => {
    render(<RunAnalysisSummary run={run} />);
    expect(screen.getByText(/73.0/)).toBeTruthy();
    expect(screen.getByText(/% success probability/i)).toBeTruthy();
    expect(screen.getByText(/across 1000 seeded runs/i)).toBeTruthy();
    expect(screen.getByText(/Final net worth · 10th percentile/i)).toBeTruthy();
    expect(screen.getAllByText(/Median final net worth/i)).toHaveLength(2);
    expect(screen.getByText(/90th percentile/i)).toBeTruthy();
    expect(screen.getByText(/coherent seeded run 411/i)).toBeTruthy();
    expect(screen.getByText(/not yearly paths/i)).toBeTruthy();
  });

  it("shows historical rolling-window metrics, representative source years and citations", () => {
    const historical: RunRecord = {
      ...run,
      id: "historical-run",
      scenario: { ...run.scenario, id: "hist", name: "JST history", simMode: "historical", historicalConfig: { startYear: 1872 } },
      analysis: {
        mode: "historical", windowCount: 99, firstWindowStartYear: 1872, latestWindowStartYear: 1970,
        successRate: 0.72, percentileNetWorth: { p10: 12_000, p50: 25_000, p90: 40_000 },
        representativeStartYear: 1900, representativeEndYear: 1950,
      },
    };
    render(<RunAnalysisSummary run={historical} />);
    const summary = screen.getByRole("complementary", { name: "Historical results" });
    expect(summary.textContent).toContain("72.0% success probability");
    expect(summary.textContent).toContain("99 complete rolling windows");
    expect(summary.textContent).toContain("1872 through 1970");
    expect(summary.textContent).toContain("1900–1950");
    expect(summary.textContent).toContain("nominal USD");
    expect(summary.textContent).toContain("no CAD/USD conversion");
    expect(summary.textContent).toContain("taxes and benefits are not historical replays");
    fireEvent.click(screen.getByText("Citations & license"));
    expect(summary.textContent).toContain("Macrofinancial History and the New Business Cycle Facts");
    expect(summary.textContent).toContain("The Rate of Return on Everything");
    expect(summary.textContent).toContain("CC BY-NC-SA 4.0");
    expect(summary.querySelector('a[href="https://www.macrohistory.net/database/"]')).toBeTruthy();
  });

  it("shows deterministic tax planning comparison and its disclosed heuristic limits", () => {
    const planned: RunRecord = {
      ...run,
      scenario: { ...run.scenario, simMode: "deterministic", withdrawalStrategy: "tax-minimizing" },
      result: {
        ...run.result,
        withdrawalPlan: {
          strategy: "tax-minimizing",
          status: "optimized",
          planningBasis: "One deterministic evaluation using the selected return assumptions.",
          plannedWithdrawals: [{ age: 66, netRrspDraw: 12_500 }],
          comparison: {
            manualTotalTax: 40_000, optimizedTotalTax: 35_000,
            manualFinalNetWorth: 800_000, optimizedFinalNetWorth: 790_000,
            manualSuccess: false, optimizedSuccess: true, manualGisTotal: 20_000, optimizedGisTotal: 24_000,
            selectionRule: "Feasibility first, then lower total tax; bounded heuristic.",
          },
        },
      },
      analysis: undefined,
    };
    render(<RunAnalysisSummary run={planned} />);
    const summary = screen.getByRole("complementary", { name: "Tax strategy planning comparison" });
    expect(summary.textContent).toContain("Total projected income tax · manual order");
    expect(summary.textContent?.toLowerCase()).toContain("selected plan");
    expect(summary.textContent?.toLowerCase()).toContain("modeled gis");
    expect(summary.textContent).toContain("age 66");
    expect(summary.textContent).toContain("does not guarantee a global optimum");
    expect(summary.textContent).toContain("selected policy fully funded every modeled year");
    expect(summary.textContent).toContain("not an apples-to-apples tax-saving comparison");
  });

  it("distinguishes manual-retained from no-feasible-policy results", () => {
    const plan = {
      strategy: "tax-minimizing" as const,
      status: "no-feasible-policy" as const,
      planningBasis: "One deterministic evaluation.",
      plannedWithdrawals: [],
      comparison: {
        manualTotalTax: 0, optimizedTotalTax: 0, manualFinalNetWorth: 0, optimizedFinalNetWorth: 0,
        manualSuccess: false, optimizedSuccess: false, manualGisTotal: 0, optimizedGisTotal: 0,
        selectionRule: "Feasibility first.",
      },
    };
    const { rerender } = render(<RunAnalysisSummary run={{ ...run, result: { ...run.result, withdrawalPlan: plan } }} />);
    expect(screen.getByRole("complementary", { name: "Tax strategy planning comparison" }).textContent).toContain("no-shortfall requirement in every modeled year");

    rerender(<RunAnalysisSummary run={{ ...run, result: { ...run.result, withdrawalPlan: { ...plan, status: "manual-retained", comparison: { ...plan.comparison, manualSuccess: true, optimizedSuccess: true } } } }} />);
    expect(screen.getByRole("complementary", { name: "Tax strategy planning comparison" }).textContent).toContain("no tested policy that fully funded every modeled year strictly reduced total projected tax");
  });
});
