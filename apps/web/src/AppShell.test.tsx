import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App, { AppShell } from "./App";
import { StoreProvider, useRuns } from "./store/api";
import type { SimulationRunner } from "./store/simulationWorkerProtocol";
import type { RunOutcome } from "./domain/run";
import { makeSampleWorkspace } from "./data/samplePlan";
import { createMemoryStorageProvider } from "./storage";
import type { StorageProvider } from "./storage";

describe("local workspace integration", () => {
  it("loads the golden sample on first launch, runs a projection, and persists profile edits across reload", async () => {
    const provider = createMemoryStorageProvider();
    const first = render(<App storageProvider={provider} />);
    await screen.findByText(/Sample plan — edit the example/);
    fireEvent.change(screen.getByLabelText("Birth year"), { target: { value: String(new Date().getFullYear() - 46) } });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Base retirement age"), { target: { value: "62" } });
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    await waitFor(async () => {
      const loaded = await provider.load();
      expect(loaded.kind).toBe("loaded");
      if (loaded.kind === "loaded") {
        expect(loaded.workspace.plan.profile.currentAge).toBe(46);
        expect(loaded.workspace.baseScenario?.retirementAge).toBe(62);
      }
    }, { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: "Projection" }));
    fireEvent.click(screen.getByRole("button", { name: "Run projection" }));
    await screen.findByRole("table");
    expect(screen.getByRole("table").textContent).not.toContain("NaN");
    first.unmount();
    render(<App storageProvider={provider} />);
    await screen.findByLabelText("Current age");
    expect((screen.getByLabelText("Current age") as HTMLInputElement).value).toBe("46");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect((screen.getByLabelText("Base retirement age") as HTMLInputElement).value).toBe("62");
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
  });

  it("does not autosave or overwrite an unreadable row before the user chooses recovery", async () => {
    const raw = { broken: true };
    const provider = createMemoryStorageProvider({ seedWorkspaceRow: raw });
    const save = vi.spyOn(provider, "save");
    const snapshot = vi.spyOn(provider, "snapshot");
    render(<App storageProvider={provider} />);
    await screen.findByText(/saved workspace could not be read/);
    expect(save).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start with the sample plan" }));
    await screen.findByLabelText("Current age");
    // Recovery uses the provider's exclusive raw operations, preserving the old
    // row before the replacement; public-method spies don't wrap that handle.
    const recovered = await provider.load();
    expect(recovered.kind).toBe("loaded");
    if (recovered.kind === "loaded") expect(recovered.workspace.meta?.name).toBe("Sample plan");
  });

  it("previews a JSON import before replacement and offers restoring the previous workspace", async () => {
    const provider = createMemoryStorageProvider();
    await provider.save(makeSampleWorkspace({ id: "original", name: "Original" }));
    render(<App storageProvider={provider} />);
    await screen.findByLabelText("Birth year");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByText("Original");
    const replacement = makeSampleWorkspace({ id: "replacement", name: "Replacement" });
    const json = JSON.stringify({ schemaVersion: 1, plans: [{ meta: replacement.meta, plan: replacement.plan }], scenarios: replacement.scenarios });
    const file = new File([json], "replacement.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText(/Import JSON/), { target: { files: [file] } });
    const preview = await screen.findByRole("region", { name: "Import preview" });
    expect(within(preview).getByText(/Replacement/)).toBeTruthy();
    const before = await provider.load();
    if (before.kind === "loaded") expect(before.workspace.meta?.name).toBe("Original");
    fireEvent.click(screen.getByRole("button", { name: "Replace workspace" }));
    await screen.findByText(/Imported "Replacement"/);
    fireEvent.click(screen.getByRole("button", { name: "Restore previous" }));
    await waitFor(async () => {
      const restored = await provider.load();
      expect(restored.kind).toBe("loaded");
      if (restored.kind === "loaded") expect(restored.workspace.meta?.name).toBe("Original");
    });
  });

  it("keeps an unavailable storage failure visible and supports an explicit session-only workspace", async () => {
    const provider: StorageProvider = {
      load: async () => { throw new Error("Storage unavailable"); },
      save: async () => {}, snapshot: async () => {}, restore: async () => null,
      readRawRow: async () => undefined,
      runExclusive: async operation => operation(provider),
    };
    render(<App storageProvider={provider} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Continue without local saving" }));
    expect(screen.getByLabelText("Current age")).toBeTruthy();
    expect(screen.queryByText("Changes save on this device")).toBeNull();
  });

  it("runs the golden sample through the store, then compares an earlier-retirement scenario", async () => {
    function RunProbe() {
      const runs = useRuns();
      return <output data-testid="run-records">{JSON.stringify(runs)}</output>;
    }
    render(<StoreProvider initialWorkspace={makeSampleWorkspace()}><AppShell /><RunProbe /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Projection" }));
    fireEvent.click(screen.getByRole("button", { name: "Run projection" }));
    await screen.findByRole("table");
    // Provenance: packages/engine/tests/golden/golden.test.ts:79 pins year-one
    // net worth to 660_532.60 with precision 0 (±$0.50). The current engine emits
    // 660_532.49 due to mortgage monthly rounding, within that documented pin.
    const records = JSON.parse(screen.getByTestId("run-records").textContent ?? "[]") as { result: { years: { netWorth: number }[] } }[];
    expect(records[0]?.result.years[0]?.netWorth).toBeCloseTo(660_532.6, 0);
    fireEvent.click(screen.getByRole("button", { name: "Scenarios" }));
    fireEvent.click(screen.getByRole("button", { name: "New scenario" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Retire three years earlier" } });
    fireEvent.change(screen.getByLabelText("Retirement age override"), { target: { value: "62" } });
    fireEvent.click(screen.getByRole("button", { name: "Run Retire three years earlier" }));
    await waitFor(() => expect(JSON.parse(screen.getByTestId("run-records").textContent ?? "[]")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const choices = screen.getAllByRole("checkbox");
    expect(choices).toHaveLength(2);
    choices.forEach(choice => fireEvent.click(choice));
    const baseline = screen.getByLabelText(/baseline/i);
    fireEvent.change(baseline, { target: { value: (baseline as HTMLSelectElement).options[1]!.value } });
    expect(screen.getByRole("table").textContent).toContain("Final net worth");
    expect(screen.getByRole("table").textContent).toContain("62");
    expect(screen.getByRole("table").textContent).toContain("Δ");
  });

  it("opens and focuses the projection table after running directly from Plan", async () => {
    render(<StoreProvider initialWorkspace={makeSampleWorkspace()}><AppShell /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Run projection" }));
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Projection" }).getAttribute("aria-current")).toBe("page");
    expect(document.activeElement?.id).toBe("projection-year-table");
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Plan" })).toBeNull();
  });

  it("opens the scenario just run rather than a previously stored base result", async () => {
    const workspace = makeSampleWorkspace();
    workspace.scenarios = [{ id: "early", name: "Early retirement", basePlanId: workspace.meta!.id, simMode: "deterministic", overrides: { retirementAge: 62 } }];
    render(<StoreProvider initialWorkspace={workspace}><AppShell /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Run projection" }));
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Scenarios" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Early retirement" }));
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Projection" }).getAttribute("aria-current")).toBe("page");
    expect(document.activeElement?.id).toBe("projection-year-table");
    fireEvent.click(screen.getByRole("button", { name: "Age 62" }));
    expect(screen.getByRole("table").textContent).toMatch(/retirement/i);
  });

  it("navigating to Projection after a saved-scenario run shows that run: dropdown matches its id and displays the completed result", async () => {
    const workspace = makeSampleWorkspace();
    workspace.scenarios = [{ id: "early", name: "Early retirement", basePlanId: workspace.meta!.id, simMode: "deterministic", overrides: { retirementAge: 62 } }];
    render(<StoreProvider initialWorkspace={workspace}><AppShell /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Scenarios" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Early retirement" }));
    await screen.findByRole("table");
    // Projection auto-navigates on the activeRun change (AppShell) and shows the
    // SAVED scenario's completed run, not the base result.
    const select = screen.getByRole("combobox", { name: /scenario to run/i }) as HTMLSelectElement;
    expect(select.value).toBe("early");
    expect(document.querySelector(".run-stamp")?.textContent).toContain("Early retirement");
    // The run carries the scenario's actual assumptions (retirement age 62 override).
    expect(screen.getAllByRole("button", { name: /^Age 62$/ }).length).toBeGreaterThanOrEqual(1);
    expect(document.querySelectorAll('[data-age="62"]').length).toBeGreaterThanOrEqual(1);
  });

  it("entering Projection mid-background-run locks the dropdown, then follows the just-completed scenario run", async () => {
    const workspace = makeSampleWorkspace();
    workspace.scenarios = [{ id: "early", name: "Early retirement", basePlanId: workspace.meta!.id, simMode: "deterministic", overrides: { retirementAge: 62 } }];
    let finish: (() => void) | undefined;
    const emptyOutcome: RunOutcome = { result: { years: [], summary: { success: true, finalNetWorth: 0 } } };
    const simulationRunner: SimulationRunner = () => new Promise<RunOutcome>((resolve) => {
      finish = () => resolve(emptyOutcome);
    });
    render(
      <StoreProvider initialWorkspace={workspace} simulationRunner={simulationRunner}>
        <AppShell />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Scenarios" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Early retirement" }));
    // Enter Projection while the run is still in flight: dropdown locked, no result.
    fireEvent.click(screen.getByRole("button", { name: "Projection" }));
    expect((screen.getByRole("combobox", { name: /scenario to run/i }) as HTMLSelectElement).disabled).toBe(true);
    expect(document.querySelector(".run-stamp")).toBeNull();
    // The run completes: the view follows the newly active run — dropdown unlocks
    // on the run's scenario id and the completed run is displayed.
    finish!();
    await waitFor(() => expect(document.querySelector(".run-stamp")?.textContent).toContain("Early retirement"));
    expect((screen.getByRole("combobox", { name: /scenario to run/i }) as HTMLSelectElement).value).toBe("early");
    expect((screen.getByRole("combobox", { name: /scenario to run/i }) as HTMLSelectElement).disabled).toBe(false);
  });

  it("hides routine save confirmation while edits still persist without draft gating", async () => {
    const provider = createMemoryStorageProvider();
    render(<App storageProvider={provider} />);
    await screen.findByLabelText("Birth year");
    expect(screen.queryByText("Saved on this device")).toBeNull();
    fireEvent.change(screen.getByLabelText("Birth year"), { target: { value: String(new Date().getFullYear() - 46) } });
    expect(screen.queryByText("Profile changes applied.")).toBeNull();
    expect((screen.getByRole("button", { name: "Run projection" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByLabelText("Workspace save status")).toBeNull();
    expect(screen.queryByText("Saved on this device")).toBeNull();
    await waitFor(async () => {
      const loaded = await provider.load();
      expect(loaded.kind).toBe("loaded");
      if (loaded.kind === "loaded") expect(loaded.workspace.plan.profile.currentAge).toBe(46);
    }, { timeout: 2000 });
  });

  it("keeps local save failures visible and actionable after removing the routine saved banner", async () => {
    const base = createMemoryStorageProvider();
    let failNextSave = true;
    const provider: StorageProvider = {
      ...base,
      save: async workspace => {
        if (failNextSave) { failNextSave = false; throw new Error("storage is full"); }
        await base.save(workspace);
      },
    };
    render(<App storageProvider={provider} />);
    expect((await screen.findByRole("alert", { name: "Workspace save error" })).textContent).toContain("Could not save locally: storage is full");
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(async () => expect((await provider.load()).kind).toBe("loaded"), { timeout: 2000 });
    expect(screen.queryByText("Saved on this device")).toBeNull();
    expect(screen.queryByRole("alert", { name: "Workspace save error" })).toBeNull();
  });

  it("normalizes an old export before import and continues autosaving later edits", async () => {
    const provider = createMemoryStorageProvider();
    render(<App storageProvider={provider} />);
    await screen.findByLabelText("Birth year");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const old = makeSampleWorkspace({ id: "old-export", name: "Old export" });
    old.plan.profile.birthYear = new Date().getFullYear() - 45;
    old.plan.profile.currentAge = 44;
    const file = new File([JSON.stringify({ schemaVersion: 1, plans: [{ meta: old.meta, plan: old.plan }], scenarios: old.scenarios })], "old.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText(/Import JSON/), { target: { files: [file] } });
    await screen.findByRole("region", { name: "Import preview" });
    fireEvent.click(screen.getByRole("button", { name: "Replace workspace" }));
    await screen.findByText(/Imported "Old export"/);
    expect((screen.getByLabelText("Current age") as HTMLInputElement).value).toBe("45");
    fireEvent.change(screen.getByLabelText("Birth year"), { target: { value: String(new Date().getFullYear() - 46) } });
    await waitFor(async () => {
      const loaded = await provider.load();
      expect(loaded.kind).toBe("loaded");
      if (loaded.kind === "loaded") expect(loaded.workspace.plan.profile.currentAge).toBe(46);
    }, { timeout: 2000 });
  });

  it("rejects an imported horizon that already ended after recalculating the age", async () => {
    const provider = createMemoryStorageProvider();
    await provider.save(makeSampleWorkspace({ id: "original", name: "Original" }));
    render(<App storageProvider={provider} />);
    await screen.findByLabelText("Birth year");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const old = makeSampleWorkspace();
    old.plan.profile = { birthYear: new Date().getFullYear() - 95, currentAge: 45, endAge: 80, province: "ON" };
    const file = new File([JSON.stringify({ schemaVersion: 1, plans: [{ meta: old.meta, plan: old.plan }], scenarios: old.scenarios })], "expired.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText(/Import JSON/), { target: { files: [file] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/endAge.*greater than.*currentAge/i);
    expect(screen.queryByRole("region", { name: "Import preview" })).toBeNull();
    const loaded = await provider.load();
    if (loaded.kind === "loaded") expect(loaded.workspace.meta?.id).toBe("original");
  });

  it("autosaves account edits without row Save buttons and keeps invalid drafts out of storage", async () => {
    const provider = createMemoryStorageProvider();
    const workspace = makeSampleWorkspace();
    workspace.plan.accounts = [{ id: "tfsa", type: "tfsa", balance: 100, assetMix: { equity: 0.6, bond: 0.3, cash: 0.1 } }];
    await provider.save(workspace);
    render(<App storageProvider={provider} />);
    await screen.findByLabelText("Birth year");
    fireEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    expect(screen.queryByText("Saved on this device")).toBeNull();
    const card = screen.getByRole("region", { name: "TFSA account summary" });
    fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
    const row = screen.getByRole("region", { name: "TFSA account" });
    expect(within(row).queryByRole("button", { name: /save/i })).toBeNull();
    fireEvent.change(within(row).getByLabelText("Current balance ($)"), { target: { value: "125" } });
    expect(within(row).queryByText(/Changes applied automatically/)).toBeNull();
    expect(screen.queryByLabelText("Workspace save status")).toBeNull();
    const pending = await provider.load();
    if (pending.kind === "loaded") expect(pending.workspace.plan.accounts[0]?.balance).toBe(100);
    expect(screen.queryByText("Saved on this device")).toBeNull();
    await waitFor(async () => {
      const saved = await provider.load();
      expect(saved.kind).toBe("loaded");
      if (saved.kind === "loaded") expect(saved.workspace.plan.accounts[0]?.balance).toBe(125);
    }, { timeout: 2000 });

    fireEvent.change(within(row).getByLabelText("Equity (%)"), { target: { value: "80" } });
    fireEvent.change(within(row).getByLabelText("Current balance ($)"), { target: { value: "222" } });
    expect(within(row).getByText(/These edits are not applied/)).toBeTruthy();
    const invalidDraft = await provider.load();
    if (invalidDraft.kind === "loaded") expect(invalidDraft.workspace.plan.accounts[0]).toMatchObject({ balance: 125, assetMix: { equity: 0.6, bond: 0.3, cash: 0.1 } });
    fireEvent.change(within(row).getByLabelText("Bonds (%)"), { target: { value: "10" } });
    expect(within(row).queryByRole("alert")).toBeNull();
    await waitFor(async () => {
      const corrected = await provider.load();
      expect(corrected.kind).toBe("loaded");
      if (corrected.kind === "loaded") expect(corrected.workspace.plan.accounts[0]).toMatchObject({ balance: 222, assetMix: { equity: 0.8, bond: 0.1, cash: 0.1 } });
    }, { timeout: 2000 });
    expect(screen.queryByText("Saved on this device")).toBeNull();
  });
});
