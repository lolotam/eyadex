import { useState, type ReactNode } from "react";
import type { PatientStatus } from "@eyadex/contracts/patients";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import type { SlotTab } from "@/shared/shell/slot-tab";

/** What a tab another area adds to the patient file is told about the file it shows. */
type PatientFileTabContext = {
  patientId: string;
  patientStatus: PatientStatus;
  permissions: readonly string[];
};

export type PatientFileExtraTab = SlotTab<PatientFileTabContext>;

/**
 * The patient file's tabs (P2 spec §7): Overview always, then the tabs the route adds, each only
 * with its key. A tab's content mounts only while it is open, so an audited read happens only when
 * the user opens it.
 */
export function PatientFileTabs({
  patientId,
  patientStatus,
  overview,
  extraTabs,
}: {
  patientId: string;
  patientStatus: PatientStatus;
  overview: ReactNode;
  extraTabs: readonly PatientFileExtraTab[];
}) {
  const { t } = useI18n();
  const { session } = useSession();
  const permissions = session?.permissions ?? [];
  const [tab, setTab] = useState("overview");
  const shown = extraTabs.filter((extra) => extra.visible(permissions));
  if (shown.length === 0) return <>{overview}</>;
  const open = shown.find((extra) => extra.id === tab);
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="mb-4 flex w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview">{t("patientTabs.overview")}</TabsTrigger>
        {shown.map((extra) => (
          <TabsTrigger key={extra.id} value={extra.id}>
            {t(extra.labelKey)}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="overview">{overview}</TabsContent>
      {open && (
        <TabsContent key={open.id} value={open.id}>
          {open.render({ patientId, patientStatus, permissions })}
        </TabsContent>
      )}
    </Tabs>
  );
}
