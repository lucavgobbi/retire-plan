import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ASSUMPTIONS } from "../../content/assumptions";
import { AssumptionsView } from "./AssumptionsView";

/** The registered engine details remain present even though their prose is folded. */
const PINNED_IDS = [
  "mortgage-rate-convention", "negative-amortization", "tax-indexation-top-brackets", "oas-recovery-cap",
  "plan-assets", "gis-employment-exemption", "projection-year-tax-indexation", "rrif-prescribed-factors",
  "rrsp-room-in-year", "rrif-minimum-tax", "deficit-gross-up", "final-mortgage-year",
  "unmatched-policy-steps", "employer-rrsp-match", "gis-sequencing", "projection-cash-reserve",
  "nonreg-acb", "capital-losses", "nonreg-draw-gains-tax", "mortgage-prepay-step",
  "investment-return-floor", "realized-gains-gis-income",
];

describe("assumptions registry", () => {
  it("keeps the known engine simplifications in the existing registry", () => {
    expect(ASSUMPTIONS.map((entry) => entry.id).sort()).toEqual([...PINNED_IDS].sort());
    for (const entry of ASSUMPTIONS) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.body.length).toBeGreaterThan(0);
      expect(["exact", "approximation", "deferred"]).toContain(entry.category);
    }
  });
});

describe("AssumptionsView", () => {
  it("leads with short topic guidance and keeps every registry entry reachable exactly once", () => {
    const { container } = render(<AssumptionsView />);
    expect(screen.getByRole("heading", { name: "What the projection includes" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Investment returns and paths" })).toBeTruthy();
    expect(screen.getByText(/historical mode uses non-canadian u\.s\. returns/i)).toBeTruthy();
    expect(screen.getByText(/a mandatory rrif minimum may exceed spending needs/i)).toBeTruthy();

    const renderedIds = [...container.querySelectorAll<HTMLElement>("[data-assumption-id]")].map((node) => node.dataset.assumptionId);
    expect(renderedIds.sort()).toEqual([...PINNED_IDS].sort());
    expect(new Set(renderedIds).size).toBe(PINNED_IDS.length);
    expect(screen.queryByText(/exact — official formulas/i)).toBeNull();
  });

  it("uses plain status labels instead of implying exactness guarantees outcomes", () => {
    render(<AssumptionsView />);
    const incomeTopic = screen.getByRole("heading", { name: "Income and public benefits" }).closest("article");
    expect(incomeTopic).toBeTruthy();
    fireEvent.click(within(incomeTopic as HTMLElement).getByText(/detailed rules \(4\)/i));
    expect(within(incomeTopic as HTMLElement).getByText("Model rule")).toBeTruthy();
    expect(within(incomeTopic as HTMLElement).getAllByText("Simplified")).toHaveLength(3);
    expect(screen.queryByText("Exact")).toBeNull();
  });

  it("filters topic cards and technical entries, opening matching details", () => {
    render(<AssumptionsView />);
    const input = screen.getByLabelText(/filter assumptions/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "RRIF" } });
    expect(screen.getByRole("status").textContent).toContain("2 topics match");
    expect(screen.getByText(/rrif minimums use the official/i)).toBeTruthy();
    expect(screen.getByText(/rrif minimum pricing is included/i)).toBeTruthy();
    expect(screen.queryByText(/mortgage rate is nominal/i)).toBeNull();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("heading", { name: "Homes, other assets and debt" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "median" } });
    expect(screen.getByText(/one actual run selected near the median/i)).toBeTruthy();
  });

  it("keeps historical proxy and licensing caveats readable in the expanded source details", () => {
    render(<AssumptionsView />);
    fireEvent.click(screen.getByText(/historical data source and licensing/i));
    const details = screen.getByText(/jst macrohistory database source and documentation/i).closest("details");
    expect(details).toBeTruthy();
    expect(within(details as HTMLElement).getByText(/no cad\/usd conversion or currency-return effects are modeled/i)).toBeTruthy();
    expect(within(details as HTMLElement).getByText(/taxes and benefits are not historical replays/i)).toBeTruthy();
    expect(within(details as HTMLElement).getByText(/noncommercial/i)).toBeTruthy();
    expect(within(details as HTMLElement).getByText(/windows cannot reach the present/i)).toBeTruthy();
    expect(within(details as HTMLElement).getAllByRole("link")).toHaveLength(2);
  });

  it("keeps Monte Carlo and tax-planner limitations visible and discoverable", () => {
    render(<AssumptionsView />);
    expect(screen.getByText(/tests bounded policies.*fully funded.*retains manual/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/filter assumptions/i), { target: { value: "Monte Carlo" } });
    expect(screen.getByText(/independent annual normal returns/i)).toBeTruthy();
    expect(screen.getByText(/not a blended path/i)).toBeTruthy();
  });

  it("reports when a filter has no matches", () => {
    render(<AssumptionsView />);
    fireEvent.change(screen.getByLabelText(/filter assumptions/i), { target: { value: "no such model item" } });
    expect(screen.getByRole("status").textContent).toContain("0 topics match");
    expect(screen.getByRole("status").textContent).toContain("Try another term");
  });
});
