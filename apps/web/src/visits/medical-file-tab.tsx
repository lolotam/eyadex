import { useState } from "react";
import { AlertCircle, Edit3, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { StatusPanel } from "@/shared/shell/status-panel";
import { errorCodeOf } from "@/shared/api/api-error";
import { MedicalFileDialog } from "./medical-file-dialog";
import { PROFILE_SECTIONS } from "./medical-file-sections";
import { useMedicalProfile } from "./medical-queries";

/** The medical file (P2-7): five sections; edited with `update:medical:*` (its `can.update`). */
export function MedicalFileTab({ patientId }: { patientId: string }) {
  const { t, formatDate } = useI18n();
  const profile = useMedicalProfile(patientId);
  const [editing, setEditing] = useState(false);
  if (profile.isLoading) return <LoadingBlock />;
  if (profile.isError || !profile.data) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("medicalFile.loadError")}
        body={t(`errors.${errorCodeOf(profile.error)}`)}
      />
    );
  }
  const data = profile.data;
  return (
    <section className="max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t("medicalFile.title")}</h2>
        {data.can.update && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Edit3 className="size-4" />
            {t("medicalFile.edit")}
          </Button>
        )}
      </div>
      <dl className="rounded-lg border bg-card">
        {PROFILE_SECTIONS.map((key) => (
          <div key={key} className="flex flex-col gap-1 border-b px-4 py-3 last:border-b-0">
            <dt className="text-xs text-muted-foreground">{t(`medicalFile.sections.${key}`)}</dt>
            <dd className="whitespace-pre-wrap text-sm">
              {data.profile[key] ?? (
                <span className="text-muted-foreground">{t("medicalFile.none")}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {data.updatedAt && data.updatedByName && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("medicalFile.updated", {
            name: data.updatedByName,
            date: formatDate(data.updatedAt),
          })}
        </p>
      )}
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4" />
        {t("medicalFile.audited")}
      </p>
      <MedicalFileDialog
        open={editing}
        patientId={patientId}
        profile={data.profile}
        onOpenChange={setEditing}
      />
    </section>
  );
}
