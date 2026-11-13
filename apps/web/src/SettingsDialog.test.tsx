import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./App";
import { StoreProvider } from "./store/api";
import { makeSampleWorkspace } from "./data/samplePlan";
import { createMemoryStorageProvider } from "./storage";

function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  return screen.getByRole("dialog", { name: "Settings" });
}

function renderShell() {
  render(<StoreProvider initialWorkspace={makeSampleWorkspace()}><AppShell provider={createMemoryStorageProvider()} /></StoreProvider>);
}

describe("settings dialog", () => {
  it("hides file and base settings from the Plan tab and shows them in the gear dialog", () => {
    renderShell();
    expect(screen.queryByRole("button", { name: "Export JSON" })).toBeNull();
    expect(screen.queryByLabelText(/Import JSON/)).toBeNull();
    expect(screen.queryByText("Base projection settings")).toBeNull();

    const dialog = openSettings();
    expect(within(dialog).getByRole("button", { name: "Export JSON" })).toBeTruthy();
    expect(within(dialog).getByLabelText(/Import JSON/)).toBeTruthy();
    expect(within(dialog).getByLabelText("Base retirement age")).toBeTruthy();
  });

  it("opens from any tab, not just Plan", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Projection" }));
    const dialog = openSettings();
    expect(within(dialog).getByRole("button", { name: "Export JSON" })).toBeTruthy();
  });

  it("closes on Escape and on the close button", () => {
    renderShell();
    openSettings();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
  });

  it("edits base projection settings inside the dialog", () => {
    renderShell();
    const dialog = openSettings();
    const age = within(dialog).getByLabelText("Base retirement age") as HTMLInputElement;
    expect(age.value).toBeTruthy();
    fireEvent.change(age, { target: { value: "63" } });
    expect((within(dialog).getByLabelText("Base retirement age") as HTMLInputElement).value).toBe("63");
  });
});
