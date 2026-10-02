import { RequirePermission } from "@/shared/permissions/require-permission";
import { ComingNextPage } from "@/shared/shell/coming-next-page";

export function ClinicAuditPage() {
  return (
    <RequirePermission resource="audit_log">
      <ComingNextPage title="nav.audit" />
    </RequirePermission>
  );
}
