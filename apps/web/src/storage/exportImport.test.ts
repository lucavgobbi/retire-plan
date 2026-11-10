import { describe, expect, it } from "vitest";
import type { Workspace } from "../domain/types";
import { SCHEMA_VERSION, validateWorkspace } from "./schema";
import {
  buildPlanFile,
  parsePlanFile,
  planFileToText,
  workspaceToText,
} from "./exportImport";
import { makeSampleWorkspace } from "../data/samplePlan";

describe("buildPlanFile / export text", () => {
  it("mirrors the live workspace into the current-schema envelope", () => {
    const ws = makeSampleWorkspace({ id: "p-fixed", name: "My plan", updatedAt: "2026-01-01T00:00:00.000Z" });
    const file = buildPlanFile(ws);
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.plans[0]?.meta).toEqual(ws.meta);
    expect(file.plans[0]?.plan.profile.currentAge).toBe(45);
    expect(file.scenarios[0]?.id).toBe("sample");
  });

  it("synthesizes meta for a never-saved workspace WITHOUT mutating it", () => {
    const ws: Workspace = { meta: null, plan: makeSampleWorkspace().plan, scenarios: [] };
    const file = buildPlanFile(ws, { makeId: () => "synthetic-1", now: () => "2026-02-03T04:05:06.000Z" });
    expect(ws.meta).toBeNull();
    expect(file.plans[0]?.meta).toEqual({
      id: "synthetic-1",
      name: "Untitled plan",
      updatedAt: "2026-02-03T04:05:06.000Z",
    });
  });

  it("serializes to pretty JSON text", () => {
    const ws = makeSampleWorkspace();
    expect(JSON.parse(workspaceToText(ws)).schemaVersion).toBe(SCHEMA_VERSION);
    expect(planFileToText(buildPlanFile(ws))).toContain("Sample plan");
  });
});

describe("parsePlanFile", () => {
  it("is a full round-trip incl. optional non-reg bookValue", () => {
    const ws = makeSampleWorkspace();
    ws.baseScenario = { retirementAge: 61, returnAssumptions: { equity: 0.04, bond: 0.015, cash: 0.01 }, withdrawalOrder: ["rrsp", "nonreg", "tfsa"] };
    const withAcb = JSON.parse(JSON.stringify(ws)) as Workspace;
    const nonreg = withAcb.plan.accounts.find((a) => a.type === "nonreg");
    if (nonreg) (nonreg as { bookValue?: number }).bookValue = 21_500;
    const text = workspaceToText(withAcb);
    const parsed = parsePlanFile(JSON.parse(text));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const rebuilt = buildPlanFile(parsed.workspace);
      expect(rebuilt).toEqual(buildPlanFile(withAcb));
      expect((parsed.workspace.plan.accounts.find((a) => a.type === "nonreg") as { bookValue?: number }).bookValue).toBe(21_500);
    }
  });

  it("records migratedFrom for pre-versioning files", () => {
    const raw = JSON.parse(JSON.stringify(buildPlanFile(makeSampleWorkspace()))) as Record<string, unknown>;
    delete raw.schemaVersion;
    const parsed = parsePlanFile(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.migratedFrom).toBe(0);
  });

  it("hard-blocks future schema versions with a named-window error", () => {
    const raw = { ...JSON.parse(JSON.stringify(buildPlanFile(makeSampleWorkspace()))), schemaVersion: 99 };
    const parsed = parsePlanFile(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.join(" ")).toMatch(/newer version of RetirePlan/);
    }
  });

  it("returns a usable errors array for garbage payloads", () => {
    expect(parsePlanFile("a string, not an object").ok).toBe(false);
    expect(parsePlanFile({}).ok).toBe(false);
    expect(parsePlanFile({ schemaVersion: SCHEMA_VERSION, plans: [], scenarios: [] }).ok).toBe(false);
  });

  it("rejects semantically invalid plans through the engine gate", () => {
    const ws = makeSampleWorkspace();
    const broken = JSON.parse(JSON.stringify(ws)) as Workspace;
    broken.plan.accounts[0]!.balance = -3;
    const text = JSON.stringify(buildPlanFile(broken));
    const parsed = parsePlanFile(JSON.parse(text));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("produces a workspace that satisfies validateWorkspace", () => {
    const parsed = parsePlanFile(JSON.parse(workspaceToText(makeSampleWorkspace())));
    if (parsed.ok) expect(validateWorkspace(parsed.workspace)).toEqual([]);
  });

  it("treats scenarios of a single-plan file as loadable even with stray basePlanId", () => {
    const file = buildPlanFile(makeSampleWorkspace());
    file.scenarios.push({
      id: "extra", name: "Extra", basePlanId: "whatever", simMode: "deterministic", overrides: {},
    });
    const parsed = parsePlanFile(JSON.parse(JSON.stringify(file)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workspace.scenarios).toHaveLength(2);
  });
});

it("rejects multi-plan imports instead of silently discarding plans", () => {
  const file = buildPlanFile(makeSampleWorkspace());
  file.plans.push({ ...file.plans[0]!, meta: { ...file.plans[0]!.meta, id: "second" } });
  const parsed = parsePlanFile(file);
  expect(parsed.ok).toBe(false);
  if (!parsed.ok) expect(parsed.errors.join(" ")).toMatch(/exactly one plan/);
});
