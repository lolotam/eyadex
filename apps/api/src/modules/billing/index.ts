// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { BillingModule } from "./billing.module.ts";
export type { ReportExportRuntime } from "./report-export-providers.ts";
// The logo upload's image body parser, registered in app.ts before Nest adds its routes (spec §3.3).
export { registerLogoUploads } from "./http/logo-upload.ts";
// The server PDF renderer port: tests bind a fake through AppDependencies until plan Task 8g lands one.
export type { InvoicePdfRenderer } from "./ports/invoice-pdf.ts";
