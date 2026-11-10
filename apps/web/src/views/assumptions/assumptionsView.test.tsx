import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ASSUMPTIONS } from "../../content/assumptions";
import { AssumptionsView } from "./AssumptionsView";

/** The pinned id list — engine-known simplifications, one entry each (plan Task 9). */
const PINNED_IDS = [
  "mortgage-rate-convention",
  "negative-amortization",
  "tax-indexation-top-brackets",
  "oas-recovery-cap",
  "plan-assets",
  "gis-employment-exemption",
  "projection-year-tax-indexation",
  "rrif-prescribed-factors",
  "rrsp-room-in-year",
  "rrif-minimum-tax",
  "deficit-gross-up",
  "final-mortgage-year",
  "unmatched-policy-steps",
  "employer-rrsp-match",
  "gis-sequencing",
  "projection-cash-reserve",
  "nonreg-acb",
  "capital-losses",
  "nonreg-draw-gains-tax",
  "mortgage-prepay-step",
  "investment-return-floor",
  "realized-gains-gis-income",
];

describe("assumptions registry", () => {
  it("pins the full engine-known simplification id list", () => {
    expect(ASSUMPTIONS.map((entry) => entry.id).sort()).toEqual([...PINNED_IDS].sort());
  });

  it("every entry has the required shape", () => {
    for (const entry of ASSUMPTIONS) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.body.length).toBeGreaterThan(0);
      expect(["exact", "approximation", "deferred"]).toContain(entry.category);
    }
  });
});

describe("AssumptionsView", () => {
  it("renders entries grouped by category with the version footer", () => {
    render(<AssumptionsView />);
    expect(screen.getByText(/exact — official formulas and data/i)).toBeTruthy();
    expect(screen.getByText(/approximated — deliberate simplifications/i)).toBeTruthy();
    expect(screen.getByText(/mortgage rate is nominal, compounded monthly/i)).toBeTruthy();
    expect(screen.getByText(/tax tables: ca-2026/i)).toBeTruthy();
  });

  it("filter narrows as you type and clears back", () => {
    render(<AssumptionsView />);
    const input = screen.getByLabelText(/filter assumptions/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "RRIF" } });
    expect(screen.getByText(/rrif minimums use the official/i)).toBeTruthy();
    expect(screen.queryByText(/mortgage rate is nominal/i)).toBeNull();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText(/mortgage rate is nominal/i)).toBeTruthy();
  });

  it("posts the OAS recovery cap as an exact rule (capped at OAS received)", () => {
    render(<AssumptionsView />);
    expect(screen.getByText(/oas recovery tax is capped at the oas actually paid/i)).toBeTruthy();
    expect(document.querySelector('[data-assumption-id="oas-recovery-cap"]')).toBeTruthy();
  });
});
