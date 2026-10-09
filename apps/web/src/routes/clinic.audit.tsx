import { createFileRoute } from "@tanstack/react-router";
import { ClinicAuditPage } from "@/audit/clinic-audit-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/audit")({
  ...pageHead("clinicAudit"),
  component: ClinicAuditPage,
});
