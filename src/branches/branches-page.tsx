import { RequirePermission } from "@/shared/permissions/require-permission";
import { BranchesContent } from "./branches-content";

export function BranchesPage() {
  return (
    <RequirePermission resource="branches">
      <BranchesContent />
    </RequirePermission>
  );
}
