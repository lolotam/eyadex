import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoicePdfModel } from "../index.ts";
import { MemoryPdfProcess } from "./pdf-process.ts";
import { TypstInvoicePdfRenderer } from "./typst-invoice-pdf.ts";

const policy = vi.hoisted(() => ({ assert: vi.fn() }));
vi.mock("./pdf-dump-policy.ts", () => ({ assertPdfDumpPolicy: policy.assert }));
const paths = {
  script: "/app/render.mjs",
  typst: "/bin/typst",
  qpdf: "/bin/qpdf",
  fonts: "/fonts",
  root: "/root",
};
const model = { patientName: "synthetic-document" } as InvoicePdfModel;

describe("shared Typst orchestration", () => {
  beforeEach(() => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    policy.assert.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(Object.keys(paths))("refuses relative %s before logo consumption", (key) => {
    expect(() => new TypstInvoicePdfRenderer({ ...paths, [key]: "relative" })).toThrow(
      "pdf_render_failed",
    );
  });

  it("refuses non-Linux and dump policy before touching the model or logo", async () => {
    const logo = vi.fn();
    const toJSON = vi.fn();
    const input = { toJSON } as unknown as InvoicePdfModel;
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    await expect(new TypstInvoicePdfRenderer(paths).render(input, logo)).rejects.toThrow(
      "pdf_render_failed",
    );
    expect(policy.assert).not.toHaveBeenCalled();
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    policy.assert.mockImplementation(() => {
      throw new Error("policy-refused");
    });
    await expect(new TypstInvoicePdfRenderer(paths).render(input, logo)).rejects.toThrow(
      "policy-refused",
    );
    expect(logo).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("defers preparation to admission and keeps the exact payload off argv", async () => {
    const dispose = vi.fn(async () => {});
    const logo = vi.fn(async () => ({ root: "/private", name: "logo.png", dispose }));
    const toJSON = vi.fn(() => model);
    let prepare: Parameters<MemoryPdfProcess["runPrepared"]>[0] | undefined;
    vi.spyOn(MemoryPdfProcess.prototype, "runPrepared").mockImplementation(async (callback) => {
      prepare = callback;
      return new Uint8Array();
    });
    await new TypstInvoicePdfRenderer(paths).render({ toJSON } as unknown as InvoicePdfModel, logo);
    expect(logo).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
    const job = await prepare!();
    expect(job.binary).toBe(process.execPath);
    expect(job.args).toEqual([
      paths.script,
      JSON.stringify({
        typst: paths.typst,
        qpdf: paths.qpdf,
        fonts: paths.fonts,
        root: "/private",
        logoFile: "logo.png",
      }),
    ]);
    expect(Buffer.from(job.input).toString()).toBe(JSON.stringify(model));
    expect(job.args.join()).not.toContain(model.patientName);
    expect(job.dispose).toBe(dispose);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("disposes once if serialization fails before transfer", async () => {
    const dispose = vi.fn(async () => {});
    vi.spyOn(MemoryPdfProcess.prototype, "runPrepared").mockImplementation(async (prepare) => {
      await prepare();
      return new Uint8Array();
    });
    const invalid = {
      toJSON() {
        throw new Error("synthetic-serialization-failure");
      },
    } as unknown as InvoicePdfModel;
    await expect(
      new TypstInvoicePdfRenderer(paths).render(invalid, async () => ({
        root: "/private",
        name: "logo.png",
        dispose,
      })),
    ).rejects.toThrow("synthetic-serialization-failure");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("never prepares a logo after admission refusal", async () => {
    const logo = vi.fn();
    vi.spyOn(MemoryPdfProcess.prototype, "runPrepared").mockRejectedValue(new Error("pdf_busy"));
    await expect(new TypstInvoicePdfRenderer(paths).render(model, logo)).rejects.toThrow(
      "pdf_busy",
    );
    expect(logo).not.toHaveBeenCalled();
  });
});
