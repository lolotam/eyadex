import { RequirePermission } from "@/shared/permissions/require-permission";
import { PatientDetail } from "./patient-detail";

export function PatientDetailPage({ patientId }: { patientId: string }) {
  return (
    <RequirePermission resource="patients">
      <PatientDetail patientId={patientId} />
    </RequirePermission>
  );
}
