import { RequirePermission } from "@/shared/permissions/require-permission";
import { ComingNextPage } from "@/shared/shell/coming-next-page";

export function BranchesPage() {
  return (
    <RequirePermission resource="branches">
      <ComingNextPage title="nav.branches" />
    </RequirePermission>
  );
}
