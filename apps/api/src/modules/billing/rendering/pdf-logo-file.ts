import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOGO_MAX_BYTES, logoType } from "../domain/logo.ts";
import { PdfProcessError } from "./pdf-process.ts";

/** Only a clinic logo may be written here: document/model bytes always use pipes. */
export async function pdfLogoFile(bytes: Buffer) {
  const type = logoType(bytes);
  if (!type || bytes.length > LOGO_MAX_BYTES) throw new PdfProcessError("pdf_render_failed");
  const root = await mkdtemp(join(tmpdir(), "eyadex-pdf-logo-"));
  const name = type === "image/png" ? "logo.png" : "logo.jpg";
  const path = join(root, name);
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch {
    await unlink(path).catch(() => undefined);
    await rmdir(root).catch(() => undefined);
    throw new PdfProcessError("pdf_render_failed");
  }
  return {
    root,
    name,
    dispose: async () => {
      try {
        await unlink(path);
        await rmdir(root);
      } catch {
        throw new PdfProcessError("pdf_render_failed");
      }
    },
  };
}
