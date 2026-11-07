import { readFileSync } from "node:fs";
import { PdfProcessError } from "./pdf-process.ts";

/** Reject a piped crash collector: core size limits do not constrain it. */
export function pdfDumpPolicyAllows(limits: string, pattern: string): boolean {
  return (
    /^Max core file size\s+0\s+0\s+bytes\s*$/m.test(limits) &&
    pattern.trim().length > 0 &&
    !pattern.trimStart().startsWith("|")
  );
}

/** The API holds the model too, so checking only native children is insufficient. */
export function assertPdfDumpPolicy(): void {
  try {
    if (
      process.platform === "linux" &&
      pdfDumpPolicyAllows(
        readFileSync("/proc/self/limits", "utf8"),
        readFileSync("/proc/sys/kernel/core_pattern", "utf8"),
      )
    )
      return;
  } catch {
    /* Missing/unreadable policy fails closed, without exposing paths or data. */
  }
  throw new PdfProcessError("pdf_render_failed");
}
