import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  rmdir: vi.fn(),
}));
vi.mock("node:fs/promises", () => fs);

import { pdfLogoFile } from "../rendering/pdf-logo-file.ts";
import { PdfCleanupError } from "../rendering/pdf-process.ts";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("partial logo write cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fs.mkdtemp.mockResolvedValue("synthetic-private-directory");
    fs.writeFile.mockRejectedValue(new Error("synthetic-write-failure"));
    fs.unlink.mockResolvedValue(undefined);
    fs.rmdir.mockResolvedValue(undefined);
  });

  it.each(["unlink", "rmdir"] as const)("reports unconfirmed %s distinctly", async (step) => {
    fs[step].mockRejectedValue(new Error("synthetic-private-path"));
    await expect(pdfLogoFile(png)).rejects.toBeInstanceOf(PdfCleanupError);
    await expect(pdfLogoFile(png)).rejects.toMatchObject({ message: "pdf_render_failed" });
  });

  it("allows a missing partial file only when directory removal succeeds", async () => {
    fs.unlink.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    await expect(pdfLogoFile(png)).rejects.toMatchObject({ message: "pdf_render_failed" });
    expect(fs.rmdir).toHaveBeenCalledOnce();
  });
});
