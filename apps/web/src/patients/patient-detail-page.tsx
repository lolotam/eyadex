import { RequirePermission } from "@/shared/permissions/require-permission";
import { PatientDetail } from "./patient-detail";
import type { PatientFileExtraTab } from "./patient-file-tabs";

/** The patient file; the route adds the tabs other areas own (CLAUDE.architecture.md §1.1). */
export function PatientDetailPage({
  patientId,
  extraTabs,
}: {
  patientId: string;
  extraTabs: readonly PatientFileExtraTab[];
}) {
  return (
    <RequirePermission resource="patients">
      <PatientDetail patientId={patientId} extraTabs={extraTabs} />
    </RequirePermission>
  );
}
