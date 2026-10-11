import type { PatientStatus } from "@eyadex/contracts/patients";
import { can } from "@/shared/permissions/can";
import type { SlotTab } from "@/shared/shell/slot-tab";
import { AttachmentsPanel } from "./attachments-panel";
import { MedicalFileTab } from "./medical-file-tab";
import { PatientVisitsTab } from "./patient-visits-tab";

type PatientFile = {
  patientId: string;
  patientStatus: PatientStatus;
  permissions: readonly string[];
};

/**
 * The medical tabs of the patient file (P2 spec §7), in order, each only with its key; the route
 * hands them to the patients area. An archived file offers no attachment upload (the API answers
 * `patient_inactive`).
 */
export const PATIENT_MEDICAL_TABS: readonly SlotTab<PatientFile>[] = [
  {
    id: "medical",
    labelKey: "patientTabs.medical",
    visible: (permissions) => can(permissions, "view", "medical"),
    render: ({ patientId }) => <MedicalFileTab patientId={patientId} />,
  },
  {
    id: "visits",
    labelKey: "patientTabs.visits",
    visible: (permissions) => can(permissions, "view", "visits"),
    render: ({ patientId }) => <PatientVisitsTab patientId={patientId} />,
  },
  {
    id: "attachments",
    labelKey: "patientTabs.attachments",
    visible: (permissions) => can(permissions, "view", "medical"),
    render: ({ patientId, patientStatus, permissions }) => (
      <AttachmentsPanel
        patientId={patientId}
        visitId={null}
        canUpload={patientStatus === "active" && can(permissions, "update", "medical")}
        canArchive={can(permissions, "update", "medical")}
      />
    ),
  },
];
