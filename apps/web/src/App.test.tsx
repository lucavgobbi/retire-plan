import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./App";
import { StoreProvider } from "./store/api";

describe("application shell", () => {
  it("offers all five views and switches the active view", () => {
    render(<StoreProvider><AppShell /></StoreProvider>);
    for (const view of ["Plan", "Projection", "Scenarios", "Compare", "Assumptions"]) expect(screen.getByRole("button", { name: view })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Plan" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assumptions" }));
    expect(screen.getByRole("heading", { name: /Assumptions & simplifications/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assumptions" }).getAttribute("aria-current")).toBe("page");
  });
});
