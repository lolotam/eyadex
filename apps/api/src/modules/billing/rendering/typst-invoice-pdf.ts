import { fileURLToPath } from "node:url";
import { TypstInvoicePdfRenderer as RuntimeRenderer } from "@eyadex/invoice-pdf/runtime";
import type { TypstPdfRuntimePaths } from "@eyadex/invoice-pdf/runtime";
import type { InvoicePdfModel } from "../domain/invoice-pdf-model.ts";
import { pdfLogoFile } from "./pdf-logo-file.ts";
import type { InvoicePdfModelRenderer } from "../ports/invoice-pdf-model.ts";

/** مسارات نشر موثوقة؛ يحتفظ التطبيق بملكية مسار السكربت. */
export type TypstPdfPaths = Omit<TypstPdfRuntimePaths, "script">;

/** محول متوافق يظل غير موصول حتى اجتياز بوابات التفعيل. */
export class TypstInvoicePdfRenderer implements InvoicePdfModelRenderer {
  private readonly renderer: RuntimeRenderer;

  /** ينشئ المصير بمسارات التطبيق الموثوقة. */
  constructor(paths: TypstPdfPaths) {
    this.renderer = new RuntimeRenderer({
      ...paths,
      script: fileURLToPath(new URL("../../../../assets/invoice-pdf/render.mjs", import.meta.url)),
    });
  }

  /** يحمل الشعار بعد حجز السعة وينقل ملكية تنظيفه للمصير. */
  async render(
    model: InvoicePdfModel,
    loadLogo?: () => Promise<Buffer | null>,
  ): Promise<Uint8Array> {
    return this.renderer.render(model, async () => {
      const bytes = await loadLogo?.();
      return bytes ? pdfLogoFile(bytes) : undefined;
    });
  }
}
