import { describe, expect, it } from "vitest";
import type { Plan } from "@budgettool/engine";
import type { Action } from "../domain/actions";
import { createEmptyWorkspace, DEFAULT_SCENARIO_BASE } from "../domain/defaults";
import { resolveScenario } from "../domain/scenario";
import type { RunRecord, SectionKey } from "../domain/types";
import { reducer, type StoreState } from "./reducer";

const items: { [K in SectionKey]: Plan[K][number] } = {
  accounts: { id: "item", type: "nonreg", balance: 100, bookValue: 80, assetMix: { equity: 1, bond: 0, cash: 0 } },
  assets: { id: "item", kind: "other", name: "Asset", value: 100, appreciationRate: 0 },
  debts: { id: "item", kind: "mortgage", balance: 100, rate: 0, termYears: 1, amortizationYears: 1, monthlyPayment: 10 },
  incomes: { id: "item", kind: "other", annualAmount: 100, startAge: 45, raiseRate: 0 },
  expenses: { id: "item", name: "Living", annualAmount: 100, startAge: 45, inflationRate: 0 },
  savingsPolicy: { id: "item", priority: 1, target: "tfsa" },
};
describe("workspace reducer", () => {
  it.each(Object.keys(items) as SectionKey[])("adds, edits, and removes %s while preserving stable ids and prior state", section => {
    const initial: StoreState = { workspace: createEmptyWorkspace(), runs: [] };
    const added = reducer(initial, { type: "plan/addItem", section, item: items[section] } as Action);
    expect(initial.workspace.plan[section]).toEqual([]);
    const updated = reducer(added, { type: "plan/updateItem", section, id: "item", patch: { ...items[section], id: "changed" } } as Action);
    expect(updated.workspace.plan[section][0]?.id).toBe("item");
    const removed = reducer(updated, { type: "plan/removeItem", section, id: "item" });
    expect(removed.workspace.plan[section]).toEqual([]);
    expect(added.workspace.plan[section]).toEqual([items[section]]);
  });
  it("retains optional ACB verbatim and supports clearing it", () => {
    let state: StoreState = { workspace: createEmptyWorkspace(), runs: [] };
    state = reducer(state, { type: "plan/addItem", section: "accounts", item: items.accounts });
    expect(state.workspace.plan.accounts[0]?.bookValue).toBe(80);
    state = reducer(state, { type: "plan/updateItem", section: "accounts", id: "item", patch: { bookValue: undefined } });
    expect(state.workspace.plan.accounts[0]?.bookValue).toBeUndefined();
  });
  it("keeps the newest twenty immutable run snapshots and clears runs on workspace replacement", () => {
    let state: StoreState = { workspace: createEmptyWorkspace(), runs: [] };
    let last!: RunRecord;
    for (let i = 0; i < 22; i++) {
      last = { id: String(i), planId: "p", scenarioId: null, scenario: resolveScenario(null, DEFAULT_SCENARIO_BASE), result: { years: [], summary: { success: true, finalNetWorth: i } }, createdAt: String(i) };
      state = reducer(state, { type: "run/store", record: last });
    }
    expect(state.runs).toHaveLength(20);
    expect(state.runs[0]?.id).toBe("2");
    last.result.summary.finalNetWorth = -1;
    expect(state.runs.at(-1)?.result.summary.finalNetWorth).toBe(21);
    expect(Object.isFrozen(state.runs.at(-1)?.result.summary)).toBe(true);
    state = reducer(state, { type: "workspace/loaded", workspace: createEmptyWorkspace() });
    expect(state.runs).toEqual([]);
  });
});
