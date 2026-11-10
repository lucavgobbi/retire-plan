import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createStorageProvider } from "./db";
import { makeSampleWorkspace } from "../data/samplePlan";

describe("IndexedDB-backed provider", () => {
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
      const request = factory.open("budgettool");
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
