import { useState, type ReactNode } from "react";
import type { PatientStatus } from "@eyadex/contracts/patients";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttachmentsPanel } from "@/medical/attachments-panel";
import { MedicalFileTab } from "@/medical/medical-file-tab";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { PatientVisitsTab } from "@/visits/patient-visits-tab";

type TabId = "overview" | "medical" | "visits" | "attachments";

/**
 * The patient file's tabs (P2 spec §7): Overview always, the others each only with its key. A tab's
 * content mounts only while it is open, so an audited read happens only when the user opens it. An
 * archived file offers no attachment upload (the API answers `patient_inactive`).
 */
export function PatientFileTabs({
  patientId,
  patientStatus,
  overview,
}: {
  patientId: string;
  patientStatus: PatientStatus;
  overview: ReactNode;
}) {
  const { t } = useI18n();
  const { session } = useSession();
  const permissions = session?.permissions ?? [];
  const [tab, setTab] = useState<TabId>("overview");
  const tabs: TabId[] = [
    "overview",
    ...(can(permissions, "view", "medical") ? (["medical"] as const) : []),
    ...(can(permissions, "view", "visits") ? (["visits"] as const) : []),
    ...(can(permissions, "view", "medical") ? (["attachments"] as const) : []),
  ];
  if (tabs.length === 1) return <>{overview}</>;
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
      <TabsList className="mb-4 flex w-full justify-start overflow-x-auto">
        {tabs.map((id) => (
          <TabsTrigger key={id} value={id}>
            {t(`patientTabs.${id}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="overview">{overview}</TabsContent>
      {tab === "medical" && (
        <TabsContent value="medical">
          <MedicalFileTab patientId={patientId} />
        </TabsContent>
      )}
      {tab === "visits" && (
        <TabsContent value="visits">
          <PatientVisitsTab patientId={patientId} />
        </TabsContent>
      )}
      {tab === "attachments" && (
        <TabsContent value="attachments">
          <AttachmentsPanel
            patientId={patientId}
            visitId={null}
            canUpload={patientStatus === "active" && can(permissions, "update", "medical")}
            canArchive={can(permissions, "update", "medical")}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}
