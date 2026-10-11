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
 * `patient_inactive`). Attachments also show to a writer without `view:medical`: the API takes its
 * file-level upload (update reach, active file) but refuses it the list, so the panel lists nothing.
 * The patient file carries no medical capability, so the keys decide (UX only: the API refuses too).
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
    visible: (permissions) =>
      can(permissions, "view", "medical") || can(permissions, "update", "medical"),
    render: ({ patientId, patientStatus, permissions }) => (
      <AttachmentsPanel
        patientId={patientId}
        visitId={null}
        canUpload={patientStatus === "active" && can(permissions, "update", "medical")}
        canArchive={can(permissions, "update", "medical")}
        canView={can(permissions, "view", "medical")}
      />
    ),
  },
];
