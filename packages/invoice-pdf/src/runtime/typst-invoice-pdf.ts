import { isAbsolute } from "node:path";
import type { InvoicePdfModel } from "../index.ts";
import { MemoryPdfProcess, PdfProcessError } from "./pdf-process.ts";
import { assertPdfDumpPolicy } from "./pdf-dump-policy.ts";
import type { PreparedPdfLogo, PreparePdfLogo, TypstPdfRuntimePaths } from "./typst-pdf-types.ts";

/** ينسق طباعة النموذج داخل حدود التشغيل الثابتة. */
export class TypstInvoicePdfRenderer {
  private readonly process = new MemoryPdfProcess();

  /** يقبل مسارات نشر موثوقة ومطلقة فقط. */
  constructor(private readonly paths: TypstPdfRuntimePaths) {
    if (Object.values(paths).some((path) => !isAbsolute(path))) {
      throw new PdfProcessError("pdf_render_failed");
    }
  }

  /** يحضر الشعار والنموذج بعد حجز السعة وينقل التنظيف للعملية. */
  async render(model: InvoicePdfModel, prepareLogo?: PreparePdfLogo): Promise<Uint8Array> {
    // Linux process-group cleanup is required for the complete native pipeline.
    if (process.platform !== "linux") throw new PdfProcessError("pdf_render_failed");
    assertPdfDumpPolicy();
    return this.process.runPrepared(async () => {
      const logo: PreparedPdfLogo | null | undefined = await prepareLogo?.();
      try {
        return {
          binary: process.execPath,
          args: [
            this.paths.script,
            JSON.stringify({
              typst: this.paths.typst,
              qpdf: this.paths.qpdf,
              fonts: this.paths.fonts,
              root: this.paths.root,
              ...(logo ? { root: logo.root, logoFile: logo.name } : {}),
            }),
          ],
          input: Buffer.from(JSON.stringify(model)),
          ...(logo ? { dispose: logo.dispose } : {}),
        };
      } catch (error) {
        await logo?.dispose();
        throw error;
      }
    });
  }
}
