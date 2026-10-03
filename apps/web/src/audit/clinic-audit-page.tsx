import { RequirePermission } from "@/shared/permissions/require-permission";
import { ClinicAuditContent } from "./clinic-audit-content";

export function ClinicAuditPage() {
  return (
    <RequirePermission resource="audit_log">
      <ClinicAuditContent />
    </RequirePermission>
  );
}
