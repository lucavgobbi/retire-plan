import { describe, expect, it } from "vitest";
import * as engine from "../src/index";

describe("engine smoke test", () => {
  it("exports a module object", () => {
    expect(engine).toBeDefined();
    expect(typeof engine).toBe("object");
  });
});
