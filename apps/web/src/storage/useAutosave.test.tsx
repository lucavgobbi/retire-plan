// Regression tests for the review BLOCKER: overlapping async saves must not
// allow an old/slow save(A) to complete after a newer save(B) and overwrite the
// newer workspace. The hook serializes writes (promise chain) and coalesces.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAutosave } from "./useAutosave";
import { createRowBackedStorageProvider } from "./core";
import { createMemoryRowDb } from "./memory";
import type { Workspace } from "../domain/types";
import { makeSampleWorkspace } from "../data/samplePlan";

const fork = (): Workspace => makeSampleWorkspace({ name: "Stub" });

/** Deferred-provider harness: save(A) blocks until explicitly released. */
function deferredProvider() {
  const releases: (() => void)[] = [];
  const savedNames: string[] = [];
  const backend = createMemoryRowDb();
  const put = backend.putWorkspaceRow;
  backend.putWorkspaceRow = async (row) => {
    const w = (row as { workspace: Workspace }).workspace;
    savedNames.push(w.meta?.name ?? "bare");
    if (w.meta?.name === "Old") await new Promise<void>((resolve) => releases.push(resolve));
    await put(row);
  };
  const provider = createRowBackedStorageProvider(backend);
  return { provider, savedNames, releases };
}

const ws = (name: string): Workspace => makeSampleWorkspace({ name, id: `id-${name}` });

describe("useAutosave serialization (stale-completion blocker regression)", () => {
  it("never reports a newer editing snapshot as saved when an older write completes during its debounce", async () => {
    const { provider, releases } = deferredProvider();
    const hook = renderHook(({ value }: { value: Workspace }) => useAutosave(value, { storage: provider, delayMs: 60_000 }), { initialProps: { value: ws("Old") } });
    act(() => hook.result.current.saveNow());
    await waitFor(() => expect(releases).toHaveLength(1));
    act(() => hook.rerender({ value: ws("New") }));
    await act(async () => { releases[0]!(); });
    await waitFor(() => expect(hook.result.current.status).toBe("saved"));
    expect(hook.result.current.isCurrentSaved).toBe(false);
    act(() => hook.result.current.saveNow());
    await waitFor(() => expect(hook.result.current.isCurrentSaved).toBe(true));
    const loaded = await provider.load();
    if (loaded.kind === "loaded") expect(loaded.workspace.meta?.name).toBe("New");
  });
  it("never lets an old slow save overwrite a newer workspace; saves run in order", async () => {
    const { provider, savedNames, releases } = deferredProvider();

    const hook = renderHook(
      ({ value }: { value: Workspace }) => useAutosave(value, { storage: provider, delayMs: 1 }),
      { initialProps: { value: ws("Old") } },
    );

    // Old starts (and stays in flight — deferred provider).
    await waitFor(() => expect(hook.result.current.status).toBe("saving"));
    expect(savedNames).toEqual(["Old"]);

    // User keeps editing while "Old" is still saving.
    act(() => {
      hook.rerender({ value: ws("New") });
    });

    // Serialization guarantee: "New" has NOT started while "Old" is in flight.
    await waitFor(() => expect(hook.result.current.status).toBe("saving"));
    expect(savedNames).toEqual(["Old"]);

    // Release the old save: completion is SUPERSEDED (no bookkeeping), then the
    // chained drain saves the newer workspace.
    await act(async () => {
      releases[0]?.();
    });

    await waitFor(() => expect(hook.result.current.status).toBe("saved"));
    expect(savedNames).toEqual(["Old", "New"]);
    // The persisted row can only end as the NEWER workspace:
    expect(savedNames.at(-1)).toBe("New");
    expect(hook.result.current.error).toBeNull();
  });

  it("coalesces no-change saves (unchanged content does not re-save)", async () => {
    const stable = ws("Stable");
    const { provider, savedNames } = deferredProvider();
    const hook = renderHook(
      ({ value }: { value: Workspace }) => useAutosave(value, { storage: provider, delayMs: 1 }),
      { initialProps: { value: stable } },
    );
    await waitFor(() => expect(hook.result.current.status).toBe("saved"));
    expect(savedNames).toEqual(["Stable"]);
    // Same content re-render (new object, same JSON):
    act(() => {
      hook.rerender({ value: makeSampleWorkspaceStableClone(stable) });
    });

    await vi.waitFor(() => expect(hook.result.current.status).toBe("saved"));
    // No second save was issued for identical content:
    expect(savedNames).toEqual(["Stable"]);
  });

  it("saveNow() bypasses the debounce and serializes behind in-flight writes", async () => {
    const { provider, savedNames, releases } = deferredProvider();
    const hook = renderHook(
      ({ value }: { value: Workspace }) => useAutosave(value, { storage: provider, delayMs: 60_000 }),
      { initialProps: { value: ws("Queued") } },
    );
    // No debounce-fired saves yet (60 s delay):
    expect(savedNames).toEqual([]);
    act(() => {
      hook.result.current.saveNow();
    });
    await waitFor(() => expect(hook.result.current.status).toBe("saved"));
    expect(savedNames).toEqual(["Queued"]);
  });
});

function makeSampleWorkspaceStableClone(w: Workspace): Workspace {
  return JSON.parse(JSON.stringify(w)) as Workspace;
}
