import { RequirePermission } from "@/shared/permissions/require-permission";
import { ComingNextPage } from "@/shared/shell/coming-next-page";

export function UsersPage() {
  return (
    <RequirePermission resource="users">
      <ComingNextPage title="nav.users" />
    </RequirePermission>
  );
}
