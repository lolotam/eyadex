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
 * hands them to the patients area. A caller who may list the attachments is offered upload and archive
 * by the list's `can` (the API's own rule: `own` reaches only the caller's patients, an archived file
 * takes no upload). A writer without `view:medical` gets the tab only with `update:medical:clinic`,
 * whose reach needs no ownership: the API takes its file-level upload on an active file but refuses it
 * the list, so the panel lists nothing. With only `update:medical:own` it cannot tell whose file this
 * is, so the tab stays hidden; such a caller adds files from a visit page (the visit's `can.attach`).
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
      can(permissions, "view", "medical") || can(permissions, "update", "medical", ["clinic"]),
    render: ({ patientId, patientStatus, permissions }) =>
      can(permissions, "view", "medical") ? (
        <AttachmentsPanel patientId={patientId} visitId={null} />
      ) : (
        <AttachmentsPanel
          patientId={patientId}
          visitId={null}
          canUpload={patientStatus === "active"}
          canArchive={false}
          canView={false}
        />
      ),
  },
];
