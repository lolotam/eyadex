import { createFileRoute } from "@tanstack/react-router";
import { PlatformAuditPage } from "@/audit/platform-audit-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/platform/audit")({
  ...pageHead("platformAudit"),
  component: PlatformAuditPage,
});
