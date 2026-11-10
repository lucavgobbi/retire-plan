import { describe, expect, it } from "vitest";
import type { PlanFile, Workspace } from "../domain/types";
import { SCHEMA_VERSION } from "./schema";
import { MIGRATIONS, migratePlanFile, migrateWorkspaceRow } from "./migrations";
import { buildPlanFile } from "./exportImport";
import { makeSampleWorkspace } from "../data/samplePlan";

const validFile = (): PlanFile => buildPlanFile(makeSampleWorkspace());

describe("PlanFile migrations", () => {
  it("accepts a current-version file unchanged", () => {
    const result = migratePlanFile(JSON.parse(JSON.stringify(validFile())));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fromVersion).toBe(SCHEMA_VERSION);
      expect(result.planFile.schemaVersion).toBe(SCHEMA_VERSION);
    }
  });

  it("migrates a pre-versioning (v0) file by identity and stamps the version", () => {
    const raw = JSON.parse(JSON.stringify(validFile())) as Record<string, unknown>;
    delete raw.schemaVersion;
    const result = migratePlanFile(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fromVersion).toBe(0);
      expect(result.planFile.schemaVersion).toBe(SCHEMA_VERSION);
      expect(result.planFile.plans[0]?.meta.name).toBe("Sample plan");
    }
  });

  it("assigns SCHEMA_VERSION=1; the v0→v1 hook is registered with a table", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(MIGRATIONS[0]).toBeDefined();
    expect(MIGRATIONS[0]?.to).toBe(1);
  });

  it("hard-blocks files from newer versions instead of best-effort loading", () => {
    const raw = { ...JSON.parse(JSON.stringify(validFile())), schemaVersion: SCHEMA_VERSION + 3 };
    const result = migratePlanFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.newerVersion).toBe(SCHEMA_VERSION + 3);
      expect(result.errors[0]).toMatch(/newer version of BudgetTool/);
    }
  });

  it("reports a schemaVersion that is not a number", () => {
    const raw = { ...JSON.parse(JSON.stringify(validFile())), schemaVersion: "one" };
    const result = migratePlanFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.newerVersion).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(migratePlanFile([1, 2, 3]).ok).toBe(false);
    expect(migratePlanFile("file").ok).toBe(false);
  });

  it("still runs the semantic gate after migration", () => {
    const raw = JSON.parse(JSON.stringify(validFile())) as Record<string, unknown>;
    delete raw.schemaVersion;
    const planPart = raw.plans as { plan: { profile: Record<string, unknown> } }[];
    delete planPart[0]!.plan.profile.province;
    const result = migratePlanFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.newerVersion).toBeNull();
  });
});

describe("workspace row migrations (db rows)", () => {
  it("passes a current row through untouched", () => {
    const row = {
      singleton: "singleton",
      schemaVersion: SCHEMA_VERSION,
      workspace: makeSampleWorkspace(),
    };
    const result = migrateWorkspaceRow(row);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schemaVersion).toBe(SCHEMA_VERSION);
      expect((result.workspace as Workspace).plan.profile.currentAge).toBe(45);
    }
  });

  it("refuses foreign newer rows with the never-modified message", () => {
    const result = migrateWorkspaceRow({ schemaVersion: SCHEMA_VERSION + 1, workspace: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.newerVersion).toBe(SCHEMA_VERSION + 1);
  });

  it("rejects malformed rows", () => {
    expect(migrateWorkspaceRow("boom").ok).toBe(false);
    expect(migrateWorkspaceRow({ schemaVersion: true, workspace: {} }).ok).toBe(false);
  });
});
