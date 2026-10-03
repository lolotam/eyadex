import { RequirePermission } from "@/shared/permissions/require-permission";
import { RolesContent } from "./roles-content";

export function RolesPage() {
  return (
    <RequirePermission resource="roles">
      <RolesContent />
    </RequirePermission>
  );
}
