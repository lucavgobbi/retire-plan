import { useEffect, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../domain/types";
import { StoreProvider, useWorkspace } from "../../store/api";
import { CompareView } from "./CompareView";
import { baseRun, deltaRun } from "./compare.test";

const runs: RunRecord[] = [baseRun, deltaRun];

const EMPTY_PLAN = {
  profile: { birthYear: 1981, currentAge: 45, province: "ON" as const, endAge: 100 },
  accounts: [], assets: [], debts: [], incomes: [], expenses: [], savingsPolicy: [],
};

/** Seeds stored runs through the store's own `run/store` action, then renders children. */
function RunSeeder({ runs: records, children }: { runs: RunRecord[]; children: ReactNode }) {
  const { dispatch } = useWorkspace();
  useEffect(() => {
    for (const record of records) dispatch({ type: "run/store", record });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{children}</>;
}

function CompareRunner({ runs: records }: { runs: RunRecord[] }) {
  return (
    <StoreProvider
      initialWorkspace={{ meta: { id: "plan-test", name: "T", updatedAt: "x" }, plan: EMPTY_PLAN, scenarios: [] }}
    >
      <RunSeeder runs={records}>
        <CompareView />
      </RunSeeder>
    </StoreProvider>
  );
}

describe("CompareView", () => {
  it("empty state: no runs stored → hint", () => {
    render(
      <StoreProvider initialWorkspace={{ meta: null, plan: EMPTY_PLAN, scenarios: [] }}>
        <CompareView />
      </StoreProvider>,
    );
    expect(screen.getByText(/no runs stored/i)).toBeTruthy();
  });

  it("stored runs appear as checkbox rows; Δ columns appear when a baseline is picked", () => {
    render(<CompareRunner runs={runs} />);
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    // Unchecked state: no table yet.
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    expect(screen.getByRole("table")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/baseline/i), { target: { value: runs[0]!.id } });
    expect(screen.getByText(/Δ vs baseline/i)).toBeTruthy();
  });

  it("checked runs fill the summary table with resolved settings", () => {
    render(<CompareRunner runs={runs} />);
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(checkboxes[0]!);
    const summaryTable = screen.getByRole("table");
    expect(summaryTable.textContent).toContain("Base scenario");
    expect(summaryTable.textContent).toContain("65"); // retirement age row
    expect(summaryTable.textContent).toContain("Withdrawal order");
    fireEvent.click(checkboxes[1]!);
    expect(summaryTable.textContent).toContain("Retire 3 years earlier");
  });

  it("overlay chart renders after selection", () => {
    render(<CompareRunner runs={runs} />);
    for (const checkbox of screen.getAllByRole("checkbox") as HTMLInputElement[]) {
      fireEvent.click(checkbox);
    }
    expect(screen.getByRole("img", { name: /net worth comparison/i })).toBeTruthy();
    const legend = screen.getByRole("list", { name: "Compared runs" });
    expect(legend.textContent).toContain("Base scenario");
    expect(legend.textContent).toContain("Retire 3 years earlier");
    expect(screen.getByRole("region", { name: "Side-by-side run comparison" })).toBeTruthy();
  });
});
