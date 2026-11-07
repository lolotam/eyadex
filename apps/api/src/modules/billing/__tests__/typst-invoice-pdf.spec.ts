import { afterEach, expect, it, vi } from "vitest";
import { MemoryPdfProcess } from "@eyadex/invoice-pdf/runtime";
import type { InvoicePdfModel } from "../domain/invoice-pdf-model.ts";
import { TypstInvoicePdfRenderer } from "../rendering/typst-invoice-pdf.ts";

const mocks = vi.hoisted(() => ({ policy: vi.fn(), logo: vi.fn() }));
vi.mock("node:fs", () => ({
  readFileSync: (path: string) =>
    path.endsWith("limits") ? "Max core file size 0 0 bytes" : "core",
}));
vi.mock("../rendering/pdf-logo-file.ts", () => ({ pdfLogoFile: mocks.logo }));
afterEach(() => vi.restoreAllMocks());

it("keeps the old signature and prepares API-owned logos only at admission", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  const load = vi.fn();
  const renderer = new TypstInvoicePdfRenderer({
    typst: "/typst",
    qpdf: "/qpdf",
    fonts: "/fonts",
    root: "/root",
  });
  await expect(renderer.render({} as InvoicePdfModel, load)).rejects.toThrow("pdf_render_failed");
  expect(load).not.toHaveBeenCalled();
  expect(mocks.logo).not.toHaveBeenCalled();
});

it("rejects relative deployment paths through the old constructor", () => {
  expect(
    () =>
      new TypstInvoicePdfRenderer({
        typst: "relative",
        qpdf: "/qpdf",
        fonts: "/fonts",
        root: "/root",
      }),
  ).toThrow("pdf_render_failed");
});

it("passes identical model bytes and an API-resolved script with single-owner cleanup", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  const dispose = vi.fn(async () => {});
  mocks.logo.mockResolvedValue({ root: "/private", name: "logo.png", dispose });
  const load = vi.fn(async () => Buffer.from("synthetic-logo"));
  const model = { patientName: "synthetic-document" } as InvoicePdfModel;
  vi.spyOn(MemoryPdfProcess.prototype, "runPrepared").mockImplementation(async (prepare) => {
    expect(load).not.toHaveBeenCalled();
    const job = await prepare();
    expect(job.args[0]?.replaceAll("\\", "/")).toMatch(
      /apps\/api\/assets\/invoice-pdf\/render.mjs$/,
    );
    expect(JSON.parse(job.args[1]!)).toEqual({
      typst: "/typst",
      qpdf: "/qpdf",
      fonts: "/fonts",
      root: "/private",
      logoFile: "logo.png",
    });
    expect(Buffer.from(job.input).toString()).toBe(JSON.stringify(model));
    expect(job.dispose).toBe(dispose);
    await job.dispose!();
    return Buffer.from("synthetic-pdf");
  });
  const renderer = new TypstInvoicePdfRenderer({
    typst: "/typst",
    qpdf: "/qpdf",
    fonts: "/fonts",
    root: "/root",
  });
  expect(Buffer.from(await renderer.render(model, load)).toString()).toBe("synthetic-pdf");
  expect(load).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
});
