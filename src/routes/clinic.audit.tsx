import { createFileRoute } from "@tanstack/react-router";
import { ClinicAuditPage } from "@/audit/clinic-audit-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/audit")({
  head: () => pageHead("Audit log", "Every change inside the clinic."),
  component: ClinicAuditPage,
});
