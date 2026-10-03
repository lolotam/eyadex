import { RequirePermission } from "@/shared/permissions/require-permission";
import { PatientsContent } from "./patients-content";

export function PatientsPage() {
  return (
    <RequirePermission resource="patients">
      <PatientsContent />
    </RequirePermission>
  );
}
