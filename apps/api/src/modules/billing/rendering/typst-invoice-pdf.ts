import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { InvoicePdfModel } from "../domain/invoice-pdf-model.ts";
import { MemoryPdfProcess, PdfProcessError } from "./pdf-process.ts";
import { assertPdfDumpPolicy } from "./pdf-dump-policy.ts";

/** Trusted, deployment-owned paths; never populated from a request. */
export interface TypstPdfPaths {
  readonly typst: string;
  readonly qpdf: string;
  readonly fonts: string;
  readonly root: string;
}

/** Not wired into BillingModule until deployment/crash and performance gates pass. */
export class TypstInvoicePdfRenderer {
  private readonly process = new MemoryPdfProcess();

  constructor(private readonly paths: TypstPdfPaths) {
    if (Object.values(paths).some((path) => !isAbsolute(path))) {
      throw new PdfProcessError("pdf_render_failed");
    }
  }

  async render(model: InvoicePdfModel): Promise<Uint8Array> {
    // Linux process-group cleanup is required for the complete native pipeline.
    if (process.platform !== "linux") throw new PdfProcessError("pdf_render_failed");
    assertPdfDumpPolicy();
    const script = fileURLToPath(
      new URL("../../../../assets/invoice-pdf/render.mjs", import.meta.url),
    );
    return this.process.run(process.execPath, [script, JSON.stringify(this.paths)], () =>
      Buffer.from(JSON.stringify(model)),
    );
  }
}
