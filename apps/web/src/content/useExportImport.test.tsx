// Lane B Task 4 — order-of-operations test for the destructive-import contract:
// parse (NO backup) → preview → CONFIRM → snapshot("pre-import") → swap + save.
// Uses the in-memory adapter injected into both the hook and the boot flow.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StoreProvider, useStore } from "../store/api";
import { useAutosave } from "../storage/useAutosave";
import { useExportImport } from "./planFileUi";
import { createMemoryStorageProvider, createMemoryRowDb } from "../storage/memory";
import { createRowBackedStorageProvider } from "../storage/core";
import { workspaceToText } from "../storage/exportImport";
import { makeSampleWorkspace } from "../data/samplePlan";
import type { Workspace } from "../domain/types";

const wsA = makeSampleWorkspace({ id: "pA", name: "Original" });
const wsB = makeSampleWorkspace({ id: "pB", name: "Imported" });
const fileText = workspaceToText(wsB);

describe("useExportImport destructive-import order", () => {
  it("takes NO backup on preview (parse only), then snapshot(swap) in confirm order", async () => {
    const rowDb = createMemoryRowDb({ now: () => "2026-01-01T00:00:00.000Z" });
    const provider = createRowBackedStorageProvider(rowDb);
    await provider.save(wsA);

    const { result } = renderHook(() => useExportImport({ storage: provider }), {
      wrapper: ({ children }) => <StoreProvider initialWorkspace={wsA}>{children}</StoreProvider>,
    });

    // 1. choose file → parse + preview. Backups untouched.
    await act(async () => {
      await result.current.importFile(new File(["unused"], "plan.json"), async () => fileText);
    });
    expect(result.current.errors).toBeNull();
    expect(result.current.candidate?.preview.planName).toBe("Imported");
    expect(await backupsCount(rowDb)).toBe(0);

    // 2. confirm → snapshot("pre-import") BEFORE swapping, then store wsB.
    await act(async () => {
      await result.current.confirmReplace();
    });
    await waitFor(() => expect(result.current.candidate).toBeNull());

    const backups = await rowDb.getBackupRows();
    expect(backups).toHaveLength(1);
    const snapshot = backups[0]!.workspace as Workspace;
    expect((snapshot.meta as { name: string }).name).toBe("Original"); // pre-swap state preserved
    expect(result.current.notice).toMatch(/Imported/);

    // 3. live workspace (via hook's provider row) is swapped + persisted:
    const loaded = await provider.load();
    expect(loaded.kind).toBe("loaded");
    if (loaded.kind === "loaded") {
      expect(loaded.workspace.meta?.name).toBe("Imported");
    }
  });

  it("restorePrevious() returns to the pre-import snapshot (single-level undo)", async () => {
    const rowDb = createMemoryRowDb({ now: () => "2026-01-01T00:00:00.000Z" });
    const provider = createRowBackedStorageProvider(rowDb);
    await provider.save(wsA);

    const { result } = renderHook(() => useExportImport({ storage: provider }), {
      wrapper: ({ children }) => <StoreProvider initialWorkspace={wsA}>{children}</StoreProvider>,
    });
    await act(async () => {
      await result.current.importFile(new File(["unused"], "plan.json"), async () => workspaceToText(wsB));
    });
    await act(async () => {
      await result.current.confirmReplace();
    });
    await act(async () => {
      await result.current.restorePrevious();
    });

    const loaded = await provider.load();
    if (loaded.kind !== "loaded") throw new Error("expected loaded");
    expect(loaded.workspace.meta?.name).toBe("Original");
    expect(result.current.notice).toMatch(/Previous workspace restored/);
  });

  it("failed parses never touch state or backups and render errors verbatim", async () => {
    const rowDb = createMemoryRowDb({ now: () => "2026-01-01T00:00:00.000Z" });
    const provider = createRowBackedStorageProvider(rowDb);
    await provider.save(wsA);

    const { result } = renderHook(() => useExportImport({ storage: provider }), {
      wrapper: ({ children }) => <StoreProvider initialWorkspace={wsA}>{children}</StoreProvider>,
    });
    await act(async () => {
      await result.current.importFile(new File(["unused"], "bad.json"), async () => "{oops");
    });
    expect(result.current.candidate).toBeNull();
    expect(result.current.errors?.[0]).toMatch(/not valid JSON/);
    expect(await rowDb.getBackupRows()).toHaveLength(0);
    const loaded = await provider.load();
    expect(loaded.kind).toBe("loaded");
    if (loaded.kind === "loaded") expect(loaded.workspace.meta?.name).toBe("Original");
  });

  it("startOver snapshots the CURRENT row before landing a fresh workspace", async () => {
    const rowDb = createMemoryRowDb({ now: () => "2026-01-01T00:00:00.000Z" });
    const provider = createRowBackedStorageProvider(rowDb);
    const bare: Workspace = { meta: null, plan: makeSampleWorkspace().plan, scenarios: [] };
    await provider.save(bare);

    const { result } = renderHook(() => useExportImport({ storage: provider }), {
      wrapper: ({ children }) => <StoreProvider initialWorkspace={bare}>{children}</StoreProvider>,
    });
    await act(async () => {
      await result.current.startOver(makeSampleWorkspace({ id: "fresh", name: "Fresh" }));
    });

    const backups = await rowDb.getBackupRows();
    expect(backups).toHaveLength(1); // "start-fresh" snapshot (corrupt-or-valid, always)
    const loaded = await provider.load();
    if (loaded.kind !== "loaded") throw new Error("expected loaded");
    expect(loaded.workspace.meta?.name).toBe("Fresh");
  });
});

async function backupsCount(rowDb: ReturnType<typeof createMemoryRowDb>): Promise<number> {
  return (await rowDb.getBackupRows()).length;
}

it("drains an in-flight autosave and cancels timers throughout an import", async () => {
  vi.useFakeTimers();
  try {
    const backend = createMemoryRowDb();
    const put = backend.putWorkspaceRow;
    let releaseOld: (() => void) | undefined;
    let releaseImported: (() => void) | undefined;
    let heldOld = false;
    const writes: string[] = [];
    backend.putWorkspaceRow = async (row) => {
      const name = (row as { workspace: Workspace }).workspace.meta!.name;
      writes.push(name);
      if (name === "Original" && !heldOld) {
        heldOld = true;
        await new Promise<void>((resolve) => { releaseOld = resolve; });
      }
      if (name === "Imported") await new Promise<void>((resolve) => { releaseImported = resolve; });
      await put(row);
    };
    const provider = createRowBackedStorageProvider(backend);
    const hook = renderHook(() => {
      const store = useStore();
      const autosave = useAutosave(store.workspace, { storage: provider, delayMs: 10 });
      return { files: useExportImport({ storage: provider }), workspace: store.workspace, autosave };
    }, { wrapper: ({ children }) => <StoreProvider initialWorkspace={wsA}>{children}</StoreProvider> });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(writes).toEqual(["Original"]);
    await act(async () => {
      await hook.result.current.files.importFile(new File([""], "import.json"), async () => fileText);
    });
    let replacing: Promise<void> | undefined;
    act(() => { replacing = hook.result.current.files.confirmReplace(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(writes).toEqual(["Original"]);
    await act(async () => { releaseOld!(); await vi.advanceTimersByTimeAsync(100); });
    expect(writes).toEqual(["Original", "Original", "Imported"]);
    expect(hook.result.current.workspace.meta?.name).toBe("Original"); // commit first
    await act(async () => { releaseImported!(); await replacing; });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(hook.result.current.workspace.meta?.name).toBe("Imported");
    expect(hook.result.current.autosave.status).toBe("saved");
    const loaded = await provider.load();
    if (loaded.kind === "recoverable") throw new Error("expected saved workspace");
    expect(loaded.workspace.meta?.name).toBe("Imported");
    expect(writes).toEqual(["Original", "Original", "Imported"]);
    hook.unmount();
  } finally { vi.useRealTimers(); }
});

it("failed import persistence preserves the live workspace and exposes an error", async () => {
  const backend = createMemoryRowDb();
  const put = backend.putWorkspaceRow;
  backend.putWorkspaceRow = async (row) => {
    if ((row as { workspace: Workspace }).workspace.meta?.name === "Imported") throw new Error("Disk full");
    await put(row);
  };
  const provider = createRowBackedStorageProvider(backend);
  await provider.save(wsA);
  const hook = renderHook(() => ({ files: useExportImport({ storage: provider }), workspace: useStore().workspace }), {
    wrapper: ({ children }) => <StoreProvider initialWorkspace={wsA}>{children}</StoreProvider>,
  });
  await act(async () => { await hook.result.current.files.importFile(new File([""], "plan.json"), async () => fileText); });
  await act(async () => { await hook.result.current.files.confirmReplace(); });
  expect(hook.result.current.files.errors).toEqual(["Disk full"]);
  expect(hook.result.current.workspace.meta?.name).toBe("Original");
  expect(hook.result.current.files.candidate).not.toBeNull();
  expect((await provider.restore())?.meta?.name).toBe("Original");
});
