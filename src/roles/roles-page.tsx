import { RequirePermission } from "@/shared/permissions/require-permission";
import { ComingNextPage } from "@/shared/shell/coming-next-page";

export function RolesPage() {
  return (
    <RequirePermission resource="roles">
      <ComingNextPage title="nav.roles" />
    </RequirePermission>
  );
}
