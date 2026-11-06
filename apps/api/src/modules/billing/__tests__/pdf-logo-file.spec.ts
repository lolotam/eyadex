import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pdfLogoFile } from "../rendering/pdf-logo-file.ts";
import { MemoryPdfProcess, PdfCleanupError } from "../rendering/pdf-process.ts";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("private logo transport", () => {
  it("closes admission after preparation reports unconfirmed partial-write cleanup", async () => {
    const runner = new MemoryPdfProcess();
    await expect(
      runner.runPrepared(async () => {
        throw new PdfCleanupError();
      }),
    ).rejects.toMatchObject({ code: "pdf_render_failed" });
    await expect(runner.run(process.execPath, [], new Uint8Array())).rejects.toMatchObject({
      code: "pdf_render_failed",
    });
  });

  it("bounds stalled disposal and never reopens admission after late cleanup", async () => {
    const runner = new MemoryPdfProcess({ cleanupMs: 20 });
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await expect(
      runner.runPrepared(async () => ({
        binary: process.execPath,
        args: ["-e", "process.stdout.write('ok')"],
        input: new Uint8Array(),
        dispose: () => pending,
      })),
    ).rejects.toMatchObject({ code: "pdf_render_failed" });
    finish();
    await expect(runner.run(process.execPath, [], new Uint8Array())).rejects.toMatchObject({
      code: "pdf_render_failed",
    });
  });
  it("writes only the logo and removes its private directory", async () => {
    const file = await pdfLogoFile(png);
    expect(await readdir(file.root)).toEqual(["logo.png"]);
    expect(await readFile(join(file.root, file.name))).toEqual(png);
    if (process.platform !== "win32") expect((await stat(file.root)).mode & 0o777).toBe(0o700);
    await file.dispose();
    await expect(stat(file.root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans logo state after a child fails before reading the model", async () => {
    let root = "";
    await expect(
      new MemoryPdfProcess().runPrepared(async () => {
        const file = await pdfLogoFile(png);
        root = file.root;
        return {
          binary: process.execPath,
          args: ["-e", "process.exit(7)"],
          input: Buffer.from("synthetic-model"),
          dispose: file.dispose,
        };
      }),
    ).rejects.toMatchObject({ code: "pdf_render_failed" });
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans logo state when the input exceeds the process bound", async () => {
    let root = "";
    await expect(
      new MemoryPdfProcess().runPrepared(async () => {
        const file = await pdfLogoFile(png);
        root = file.root;
        return {
          binary: process.execPath,
          args: [],
          input: new Uint8Array(32 * 1024 * 1024 + 1),
          dispose: file.dispose,
        };
      }),
    ).rejects.toMatchObject({ code: "pdf_render_failed" });
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([Buffer.from("not-an-image"), Buffer.concat([png, Buffer.alloc(1024 * 1024)])])(
    "refuses unsupported or oversized logos before creating a file",
    async (bytes) => {
      await expect(pdfLogoFile(bytes)).rejects.toMatchObject({ code: "pdf_render_failed" });
    },
  );

  it("times out stalled preparation, refuses new work and cleans a late logo", async () => {
    const runner = new MemoryPdfProcess({ executionMs: 50 });
    let finish!: (value: {
      binary: string;
      args: string[];
      input: Uint8Array;
      dispose: () => Promise<void>;
    }) => void;
    const late = new Promise<Parameters<typeof finish>[0]>((resolve) => {
      finish = resolve;
    });
    await expect(runner.runPrepared(() => late)).rejects.toMatchObject({
      code: "pdf_render_failed",
    });
    await expect(runner.run(process.execPath, [], new Uint8Array())).rejects.toMatchObject({
      code: "pdf_render_failed",
    });
    const file = await pdfLogoFile(png);
    let cleaned!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      cleaned = resolve;
    });
    finish({
      binary: process.execPath,
      args: [],
      input: new Uint8Array(),
      dispose: async () => {
        await file.dispose();
        cleaned();
      },
    });
    await cleanup;
    await expect(stat(file.root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("charges preparation time against the same native execution deadline", async () => {
    const runner = new MemoryPdfProcess({ executionMs: 1000 });
    await expect(
      runner.runPrepared(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          binary: process.execPath,
          args: ["-e", "setTimeout(()=>process.stdout.write('late'),750)"],
          input: new Uint8Array(),
        };
      }),
    ).rejects.toMatchObject({ code: "pdf_render_failed" });
  });

  it("closes admission when resource cleanup fails without leaking its error", async () => {
    const runner = new MemoryPdfProcess();
    await expect(
      runner.runPrepared(async () => ({
        binary: process.execPath,
        args: ["-e", "process.stdout.write('ok')"],
        input: new Uint8Array(),
        dispose: async () => {
          throw new Error("synthetic-private-path");
        },
      })),
    ).rejects.toMatchObject({ message: "pdf_render_failed" });
    await expect(runner.run(process.execPath, [], new Uint8Array())).rejects.toMatchObject({
      code: "pdf_render_failed",
    });
  });
});
