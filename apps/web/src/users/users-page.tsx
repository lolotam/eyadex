import { RequirePermission } from "@/shared/permissions/require-permission";
import { UsersContent } from "./users-content";

export function UsersPage() {
  return (
    <RequirePermission resource="users">
      <UsersContent />
    </RequirePermission>
  );
}
