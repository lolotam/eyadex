// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { BillingModule } from "./billing.module.ts";
// The logo upload's image body parser, registered in app.ts before Nest adds its routes (spec §3.3).
export { registerLogoUploads } from "./http/logo-upload.ts";
