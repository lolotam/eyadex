import { RequirePermission } from "@/shared/permissions/require-permission";
import { ComingNextPage } from "@/shared/shell/coming-next-page";

export function PatientsPage() {
  return (
    <RequirePermission resource="patients">
      <ComingNextPage title="nav.patients" />
    </RequirePermission>
  );
}
