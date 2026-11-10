import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioDelta } from "../../domain/types";
import { useWorkspace } from "../../store/api";
import { StoreProvider } from "../../store/StoreProvider";
import { DEFAULT_SCENARIO_BASE } from "../../domain/defaults";
import { makeSamplePlan, makeWorkspace } from "../projection/testFixtures";
import { ScenariosView } from "./ScenariosView";

const delta: ScenarioDelta = {
  id: "delta-1",
  name: "Retire 3 years earlier",
  basePlanId: "plan-test",
  simMode: "deterministic",
  overrides: { retirementAge: 62 },
};

function renderView(workspace = makeWorkspace()) {
  return render(
    <StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
      <ScenariosView />
    </StoreProvider>,
  );
}

describe("ScenariosView", () => {
  it("empty state offers creating the first scenario", () => {
    renderView();
    expect(screen.getByText(/no scenarios yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /new scenario/i })).toBeTruthy();
  });

  it("create saves on edit, without a Save button, and later edits update the same delta", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /new scenario/i }));
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    const nameBox = screen.getByLabelText(/name/i);
    fireEvent.change(nameBox, { target: { value: "Retire 3y earlier" } });
    const item = screen.getByText(/retire 3y earlier/i);
    expect(item.closest("li")!.textContent).toMatch(/retirement age 65/i);

    fireEvent.change(screen.getByLabelText(/retirement age override/i), { target: { value: "62" } });
    expect(screen.getAllByText(/retire 3y earlier/i)).toHaveLength(1);
    expect(screen.getAllByText(/retire 3y earlier/i)[0]!.closest("li")!.textContent).toMatch(/retirement age 62/i);
  });

  it("existing delta lists its overrides and can run, showing a summary strip", () => {
    const ws = makeWorkspace(makeSamplePlan());
    ws.scenarios.push(delta);
    renderView(ws);
    fireEvent.click(screen.getByRole("button", { name: /run retire 3 years earlier/i }));
    const item = screen.getByText(/retire 3 years earlier/i);
    const strip = within(item.closest("li")!).getByText(/final net worth/i);
    expect(strip).toBeTruthy();
  });

  it("edit loads overrides into the form; withdrawal order duplicate gets an inline error", () => {
    const ws = makeWorkspace();
    ws.scenarios.push(delta);
    renderView(ws);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const first = screen.getByLabelText(/1st drawn/i) as HTMLSelectElement;
    expect(first.value).toBe("tfsa");
    fireEvent.change(first, { target: { value: "tfsa" } });
    fireEvent.change(screen.getByLabelText(/2nd drawn/i), { target: { value: "tfsa" } });
    expect(screen.getByText(/choose each withdrawal account exactly once/i)).toBeTruthy();
  });

  it("montecarlo and historical sim modes are visible but disabled with a Phase-3 hint", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /new scenario/i }));
    for (const mode of ["montecarlo", "historical"]) {
      const option = screen.getByRole("option", { name: new RegExp(mode, "i") });
      expect(option).toBeTruthy();
    }
    expect(screen.getByText(/coming in phase 3/i)).toBeTruthy();
  });

  it("delete removes the scenario after the plain confirm dialog", () => {
    const ws = makeWorkspace();
    ws.scenarios.push(delta);
    renderView(ws);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.queryByText(/retire 3 years earlier/i)).toBeNull();
  });

  it("edit keeps untouched rates byte-identical; Back closes without a save button", () => {
    const decimal = makeWorkspace();
    decimal.scenarios.push({
      ...delta,
      overrides: {
        retirementAge: 62,
        returnAssumptions: { equity: 0.055, bond: 0.035, cash: 0.01 },
        withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
      },
    });
    const Probe = () => {
      const workspace = useWorkspace();
      const stored = workspace.workspace.scenarios[0]?.overrides?.returnAssumptions;
      return <p data-testid="stored-rates">{JSON.stringify(workspace.workspace.scenarios[0]?.overrides ?? {})}|{stored ? `${stored.equity}/${stored.bond}/${stored.cash}` : "none"}</p>;
    };
    render(
      <StoreProvider initialWorkspace={decimal} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
        <ScenariosView />
        <Probe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const equity = screen.getByLabelText(/equity %/i) as HTMLInputElement;
    expect(equity.value).toBe("5.5");
    expect(screen.queryByRole("button", { name: /^save scenario$/i })).toBeNull();
    // Close WITHOUT touching any field — rates must survive byte-identical.
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByTestId("stored-rates").textContent).toBe(
      `{"retirementAge":62,"returnAssumptions":{"equity":0.055,"bond":0.035,"cash":0.01},"withdrawalOrder":["tfsa","nonreg","rrsp"]}|0.055/0.035/0.01`);

    // Editing while open updates the same delta in place.
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText(/equity %/i), { target: { value: "6" } });
    expect(screen.getByTestId("stored-rates").textContent).toBe(
      `{"retirementAge":62,"returnAssumptions":{"equity":0.06,"bond":0.035,"cash":0.01},"withdrawalOrder":["tfsa","nonreg","rrsp"]}|0.06/0.035/0.01`);
    expect(screen.getAllByText(/retire 3 years earlier/i)).toHaveLength(1);
  });

  it("retirement age validation still rejects fractional years", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /new scenario/i }));
    // An invalid draft blocks any name-only dispatch edge case: even a valid name
    // cannot apply while the age is fractional.
    fireEvent.change(screen.getByLabelText(/retirement age override/i), { target: { value: "65.5" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Fractional" } });
    expect(screen.getByText(/retirement age must be a whole number of years/i)).toBeTruthy();
    expect(screen.queryByText(/fractional/i)).toBeNull();
  });
});
