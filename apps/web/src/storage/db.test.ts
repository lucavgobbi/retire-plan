import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createStorageProvider } from "./db";
import { makeSampleWorkspace } from "../data/samplePlan";
import { buildPlanFile, parsePlanFile } from "./exportImport";

describe("IndexedDB-backed provider", () => {
  it("persists projection settings locally and preserves them in an exported/imported PlanFile", async () => {
    const factory = new IDBFactory();
    const savedAt = "2026-03-01T00:00:00.000Z";
    const workspace = makeSampleWorkspace({ id: "prefs-idb", name: "Saved preferences", updatedAt: savedAt });
    workspace.projectionScenarioId = "sample";
    workspace.projectionRunSummaryCollapsed = true;
    workspace.projectionSankeyShowAccounts = false;
    workspace.hiddenProjectionColumns = ["tax.total"];
    workspace.hiddenProjectionCharts = ["net-worth"];
    workspace.baseScenario = {
      simMode: "montecarlo",
      retirementAge: 63,
      returnAssumptions: { equity: 0.05, bond: 0.02, cash: 0 },
      withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
      mcConfig: { runs: 750, stdDev: { equity: 0.17, bond: 0.06, cash: 0.01 }, seed: 4_321 },
      benefits: { cpp: true, oas: false, gis: false },
      withdrawalStrategy: "tax-minimizing",
    };
    const provider = createStorageProvider(factory, { now: () => savedAt });
    await provider.save(workspace);

    const reloaded = await createStorageProvider(factory, { now: () => savedAt }).load();
    expect(reloaded.kind).toBe("loaded");
    if (reloaded.kind !== "loaded") return;
    expect(reloaded.workspace).toMatchObject({
      projectionScenarioId: "sample",
      projectionRunSummaryCollapsed: true,
      projectionSankeyShowAccounts: false,
      hiddenProjectionColumns: ["tax.total"],
      hiddenProjectionCharts: ["net-worth"],
      baseScenario: workspace.baseScenario,
    });

    const imported = parsePlanFile(JSON.parse(JSON.stringify(buildPlanFile(reloaded.workspace))));
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(buildPlanFile(imported.workspace)).toEqual(buildPlanFile(workspace));
  });

  it("commits writes, reloads through a second provider and retains only three backups", async () => {
    const factory = new IDBFactory();
    let tick = 0;
    const provider = createStorageProvider(factory, { now: () => new Date(1700000000000 + tick++).toISOString() });
    expect((await provider.load()).kind).toBe("fresh");
    for (let i = 1; i <= 4; i++) {
      await provider.save(makeSampleWorkspace({ id: "idb-test", name: `Saved ${i}` }));
      await provider.snapshot("test");
    }
    const reloaded = await createStorageProvider(factory).load();
    expect(reloaded.kind).toBe("loaded");
    if (reloaded.kind !== "recoverable") expect(reloaded.workspace.meta?.name).toBe("Saved 4");
    expect((await provider.restore())?.meta?.name).toBe("Saved 4");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open("retire-plan");
      request.onsuccess = () => resolve(request.result);
    });
    const count = await new Promise<number>((resolve) => {
      const request = db.transaction("backups").objectStore("backups").count();
      request.onsuccess = () => resolve(request.result);
    });
    expect(count).toBe(3);
    expect(db.objectStoreNames.contains("workspace")).toBe(true);
    db.close();
  });
});
