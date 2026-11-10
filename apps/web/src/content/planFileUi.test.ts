import { describe, expect, it } from "vitest";
import type { PlanFile } from "../domain/types";
import {
  downloadRawRowJson,
  downloadWorkspaceJson,
  parseImportText,
  previewPlanFile,
  suggestedExportFilename,
  readImportFile,
} from "./planFileUi";
import { buildPlanFile } from "../storage/exportImport";
import { makeSampleWorkspace } from "../data/samplePlan";

/** Minimal injected DOM shim: records anchors, no real object URLs. */
function shimDom(opts: { objectUrl?: boolean; body?: boolean } = {}) {
  const clicks: string[] = [];
  const revocations: string[] = [];
  const anchorName = (a: { href: string }) => a.href;
  const doc = {
    createElement: () => ({
      href: "",
      download: "",
      click: function (this: { href: string }) {
        clicks.push(anchorName(this));
      },
      remove: () => undefined,
    }),
    body: opts.body === false ? undefined : { appendChild: () => undefined },
  } as unknown as Document;
  return {
    dom: {
      doc,
      createObjectURL: opts.objectUrl ? ((blob: Blob) => `blob:fake:${blob.size}`) : undefined,
      revokeObjectURL: opts.objectUrl ? ((url: string) => revocations.push(url)) : undefined,
    },
    clicks,
    revocations,
  };
}

describe("export helpers (injected DOM)", () => {
  it("suggests a slug + date-stamped filename; meta null → plain name", () => {
    const named = suggestedExportFilename(
      makeSampleWorkspace({ name: "Retire June 2046" }),
      new Date("2026-03-04T00:00:00.000Z"),
    );
    expect(named).toBe("budgettool-retire-june-2046-2026-03-04.json");
    expect(suggestedExportFilename({ ...makeSampleWorkspace(), meta: null }, new Date("2026-03-04T00:00:00.000Z"))).toBe(
      "budgettool-2026-03-04.json",
    );
  });

  it("downloads via injected createObjectURL and revokes after click", () => {
    const { dom, clicks, revocations } = shimDom({ objectUrl: true });
    const { fileName } = downloadWorkspaceJson(makeSampleWorkspace(), dom);
    expect(fileName).toMatch(/^budgettool-.*\.json$/);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatch(/^blob:fake:/);
    expect(revocations[0]).toBe(clicks[0]);
  });

  it("falls back to a data: URL when createObjectURL is unavailable (jsdom)", () => {
    const { dom, clicks, revocations } = shimDom();
    downloadWorkspaceJson(makeSampleWorkspace(), dom);
    expect(clicks[0]).toMatch(/^data:application\/json/);
    expect(revocations).toHaveLength(0);
  });

  it("raw-row debug export is verbatim JSON, no interpretation", () => {
    const { dom, clicks } = shimDom();
    const corrupt = { schemaVersion: 1, workspace: { junk: true } };
    downloadRawRowJson(corrupt, dom);
    expect(JSON.parse(decodeURIComponent((clicks[0] as string).split(",")[1] as string))).toEqual(corrupt);
  });
});

describe("import text + preview", () => {
  it("parseImportText: malformed JSON → friendly errors, no throw", () => {
    const parsed = parseImportText("{not json at all");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]).toMatch(/not valid JSON/);
    if (!parsed.ok) expect(parsed.errors[0]).toMatch(/Nothing was changed/);
  });

  it("readImportFile: injected reader wins; default FileReader resolves text", async () => {
    expect(await readImportFile(new File(["ignored"], "plan.json", { type: "application/json" }), async () => "injected"))
      .toBe("injected");
    const text = await readImportFile(new File(["hello"], "plan.json"),);
    expect(text).toBe("hello");
  });

  it("previewPlanFile: name, ages, scenario count, imported vs current version", () => {
    const file: PlanFile = makeSampleWorkspace({ name: "Winter plan" }) as unknown as PlanFile;
    const pf = buildPlanFile(makeSampleWorkspace({ name: "Winter plan" }));
    const preview = previewPlanFile(pf, { fileName: "w.json", importedFrom: 0 });
    expect(preview.planName).toBe("Winter plan");
    expect(preview.profile).toBe("age 45 → 95 (ON)");
    expect(preview.scenarioCount).toBe(1);
    expect(preview.conformsToCurrent).toBe(true);
    expect(file).toBeDefined();
  });

  it("previewPlanFile: future-version payloads surface the hard block in issues", () => {
    const pf = buildPlanFile(makeSampleWorkspace());
    pf.schemaVersion = 99;
    const preview = previewPlanFile(pf, { importedFrom: 99 });
    expect(preview.conformsToCurrent).toBe(false);
    expect(preview.issues.some((issue) => issue.includes("newer version"))).toBe(true);
  });
});
