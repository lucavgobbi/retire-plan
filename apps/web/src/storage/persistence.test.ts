import { describe, expect, it } from "vitest";
import type { Workspace } from "../domain/types";
import { createRowBackedStorageProvider, startFresh } from "./core";
import { createMemoryRowDb } from "./memory";
import { buildPlanFile, parsePlanFile } from "./exportImport";
import { makeSampleWorkspace } from "../data/samplePlan";

const TICKS = [
  "2026-01-01T00:00:00.000Z",
  "2026-01-01T00:01:00.000Z",
  "2026-01-01T00:02:00.000Z",
  "2026-01-01T00:03:00.000Z",
];
const nowAt = (i: number) => () => TICKS[i]!;

const ws = (name: string, id = `${name}-plan`): Workspace =>
  makeSampleWorkspace({ id, name, updatedAt: TICKS[0]! });

/** Fresh provider + its seam, so tests can assert on RAW rows (no private poking). */
type Harness = ReturnType<typeof buildHarness>;
function buildHarness(options: Parameters<typeof createMemoryRowDb>[number] = {}) {
  const rowDb = createMemoryRowDb(options);
  return { rowDb, provider: createRowBackedStorageProvider(rowDb, { now: options.now ?? nowAt(0) }) };
}

describe("fresh + loaded + safe save", () => {
  it("returns a fresh empty workspace on a clean DB", async () => {
    const { provider } = buildHarness();
    const outcome = await provider.load();
    expect(outcome.kind).toBe("fresh");
    if (outcome.kind === "fresh") {
      expect(outcome.workspace.meta).toBeNull();
      expect(outcome.workspace.scenarios).toEqual([]);
    }
  });

  it("roundtrips save→load; stamps a meta COPY, never mutating the input", async () => {
    const { provider } = buildHarness({ now: nowAt(1) });
    const input = ws("Mine");
    await provider.save(input);
    const outcome = await provider.load();
    expect(outcome.kind).toBe("loaded");
    if (outcome.kind === "loaded") {
      expect(outcome.workspace.meta?.name).toBe("Mine");
      expect(outcome.workspace.meta?.updatedAt).toBe(TICKS[1]!);
    }
    expect(input.meta?.updatedAt).toBe(TICKS[0]!); // frozen-safe
  });

  it("save() with meta null keeps it null (unterminated-workspace contract)", async () => {
    const { provider } = buildHarness();
    const bare: Workspace = { meta: null, plan: makeSampleWorkspace().plan, scenarios: [] };
    await provider.save(bare);
    const outcome = await provider.load();
    if (outcome.kind !== "loaded") throw new Error("expected loaded");
    expect(outcome.workspace.meta).toBeNull();
  });

  it("REFUSES invalid workspaces and keeps the previous row intact (safe error)", async () => {
    const { provider } = buildHarness({ now: nowAt(1) });
    await provider.save(ws("Good"));
    const bad = ws("Bad");
    bad.plan.accounts[0]!.balance = -1;
    await expect(provider.save(bad)).rejects.toThrow(/Refused to save/);
    const outcome = await provider.load();
    if (outcome.kind !== "loaded") throw new Error("previous row must survive");
    expect(outcome.workspace.meta?.name).toBe("Good");
  });

  it("refuses to overwrite a workspace row saved by a NEWER app version", async () => {
    const { provider } = buildHarness({
      seedWorkspaceRow: {
        singleton: "singleton",
        schemaVersion: 9999,
        workspace: makeSampleWorkspace(),
      },
    });
    expect((await provider.load()).kind).toBe("recoverable"); // never guessed at
    await expect(provider.save(ws("Attempt"))).rejects.toThrow(/newer BudgetTool/);
  });
});

describe("snapshot FIFO cap 3", () => {
  it("keeps the 3 newest backups and evicts the oldest", async () => {
    const { provider, rowDb } = buildHarness({ now: nowAt(0) });
    await provider.save(ws("One", "plan1"));
    await provider.snapshot("r1");
    const provider2 = createRowBackedStorageProvider(rowDb, { now: nowAt(1) });
    await provider2.snapshot("r2");
    const provider3 = createRowBackedStorageProvider(rowDb, { now: nowAt(2) });
    await provider3.snapshot("r3");
    const provider4 = createRowBackedStorageProvider(rowDb, { now: nowAt(3) });
    await provider4.snapshot("r4");

    const backups = await rowDb.getBackupRows();
    expect(backups).toHaveLength(3);
    expect(backups.map((b) => b.createdAt).sort()).toEqual([TICKS[1]!, TICKS[2]!, TICKS[3]!]);
  });

  it("restore() returns the newest VALID backup; corrupt backups skipped, not served/deleted", async () => {
    const { provider } = buildHarness({
      now: nowAt(0),
      seedBackupRows: [
        { createdAt: "2025-12-01T00:00:00.000Z", workspace: { corrupted: true } },
        { createdAt: "2025-12-02T00:00:00.000Z", workspace: ws("Older valid", "old") },
        { createdAt: "2025-12-03T00:00:00.000Z", workspace: ws("Newest valid", "new") },
      ],
    });
    const restored = await provider.restore();
    expect(restored?.meta?.name).toBe("Newest valid");
  });
});

describe("corrupt-row recovery ladder (never destroys data)", () => {
  it("keeps the raw corrupt row IN PLACE and offers the newest valid backup", async () => {
    const corrupt = { schemaVersion: 1, workspace: { meta: null, half: "written" } };
    const { provider, rowDb } = buildHarness({
      seedWorkspaceRow: corrupt,
      seedBackupRows: [{ createdAt: "2025-12-01T00:00:00.000Z", workspace: ws("Backup", "b1") }],
    });
    const outcome = await provider.load();
    expect(outcome.kind).toBe("recoverable");
    if (outcome.kind === "recoverable") expect(outcome.offered?.meta?.name).toBe("Backup");

    const rawAfterLoad = await rowDb.getWorkspaceRow();
    expect(rawAfterLoad).toBe(corrupt); // same object — load never mutated/wiped
  });

  it("a recoverable load with NO backup still offers nothing (no auto-wipe anywhere)", async () => {
    const { provider, rowDb } = buildHarness({
      seedWorkspaceRow: { junk: "row" },
    });
    const outcome = await provider.load();
    expect(outcome).toEqual({ kind: "recoverable", offered: null });
    expect(await rowDb.getWorkspaceRow()).toEqual({ junk: "row" });
  });
});

describe("start-fresh writes a backup BEFORE clearing", () => {
  it("snapshots the corrupt row first, then lands the fresh workspace loadably", async () => {
    const corrupt = { schemaVersion: 1, workspace: { meta: null, half: "written" } };
    const { provider, rowDb } = buildHarness({ now: nowAt(0), seedWorkspaceRow: corrupt });
    await startFresh(provider, makeSampleWorkspace({ name: "Fresh", id: "fresh" }));

    const outcome = await provider.load();
    expect(outcome.kind).toBe("loaded");
    if (outcome.kind === "loaded") expect(outcome.workspace.meta?.name).toBe("Fresh");

    // The corrupt row content is preserved as a reachable backup:
    const backups = await rowDb.getBackupRows();
    const hadCorrupt = backups.some(
      (b) => (b.workspace as { half?: string }).half === "written",
    );
    expect(hadCorrupt).toBe(true);
    // restore() refuses to serve the corrupt snapshot — and it is the only one:
    const restored = await provider.restore();
    expect(restored).toBeNull();
  });
});

describe("persisted-row export roundtrip", () => {
  it("a loaded workspace re-exports the same PlanFile JSON", async () => {
    const { provider } = buildHarness({ now: nowAt(1) });
    const original = ws("Loop");
    await provider.save(original);
    const loaded = await provider.load();
    if (loaded.kind !== "loaded") throw new Error("expected loaded");

    const written = buildPlanFile(original);
    const exported = buildPlanFile(loaded.workspace);
    // updatedAt differs only by the save-time stamp:
    expect(exported.plans[0]?.meta?.updatedAt).toBe(TICKS[1]!);
    expect(exported.plans[0]?.plan).toEqual(written.plans[0]?.plan);
    const parsed = parsePlanFile(JSON.parse(JSON.stringify(exported)));
    expect(parsed.ok).toBe(true);
  });
});

it("restores the latest insertion and evicts the oldest when backup timestamps tie", async () => {
  const { provider, rowDb } = buildHarness({ now: nowAt(0) });
  for (const name of ["One", "Two", "Three", "Four"]) {
    await provider.save(ws(name));
    await provider.snapshot("same-clock-tick");
  }
  expect((await provider.restore())?.meta?.name).toBe("Four");
  const retained = await rowDb.getBackupRows();
  expect(retained.map((row) => (row.workspace as Workspace).meta?.name)).toEqual(["Two", "Three", "Four"]);
});
