import { useState } from "react";
import { AlertCircle, Archive, Edit3, RotateCcw, ShieldCheck } from "lucide-react";
import { formatFileNumber } from "@eyadex/contracts/patients";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { PatientFormDialog } from "./patient-form-dialog";
import { usePatientDetail } from "./patient-queries";
import { PatientStatusBadge } from "./patient-status-badge";
import { PatientStatusDialog, type PatientStatusTarget } from "./patient-status-dialog";

import { PatientBackLink as BackLink } from "./patient-back-link";
import { PatientFileTabs, type PatientFileExtraTab } from "./patient-file-tabs";

export function PatientDetail({
  patientId,
  extraTabs,
}: {
  patientId: string;
  extraTabs: readonly PatientFileExtraTab[];
}) {
  const { t, pick, lang } = useI18n();
  const { session } = useSession();
  const detail = usePatientDetail(patientId);
  const [editing, setEditing] = useState(false);
  const [statusTarget, setStatusTarget] = useState<PatientStatusTarget | null>(null);

  if (detail.isLoading) return <LoadingBlock />;
  const patient = detail.isError ? undefined : detail.data;
  if (!patient)
    return (
      <div>
        <BackLink />
        <StatusPanel
          icon={AlertCircle}
          title={t("patients.detailError")}
          body={t("errors.not_found")}
        />
      </div>
    );

  const locale = lang === "ar" ? "ar-KW" : "en-GB";
  // A birth date is a calendar date: read and print it in UTC so no zone can shift the day.
  const fmtDay = (day: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`),
    );
  const fmtInstant = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: session?.clinic?.timezone ?? "Asia/Kuwait",
    }).format(new Date(iso));
  const rows: [string, string, boolean?][] = [
    [t("patients.columns.fileNumber"), formatFileNumber(patient.fileNumber), true],
    [t("patients.fields.phone"), patient.phone, true],
    [t("patients.fields.birthDate"), fmtDay(patient.birthDate)],
    [t("patients.fields.gender"), t(`patients.gender.${patient.gender}`)],
    [t("patients.fields.branch"), pick(patient.branchNameAr, patient.branchNameEn)],
    [t("patients.fields.civilId"), patient.civilId ?? t("patients.none"), true],
    [t("patientMessages.email"), patient.email ?? t("patients.none"), true],
    [
      t("patientMessages.language"),
      patient.messageLanguage
        ? t(`language.${patient.messageLanguage}`)
        : t("patientMessages.languageDefault"),
    ],
    [
      t("patientMessages.section"),
      t(patient.notificationsOptOut ? "patientMessages.optOutYes" : "patientMessages.optOutNo"),
    ],
    [t("patients.fields.createdAt"), fmtInstant(patient.createdAt)],
  ];

  return (
    <div>
      <BackLink />
      <PageHeader
        title={patient.fullName}
        subtitle={t("patients.detailTitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PatientStatusBadge status={patient.status} />
            {patient.actions.update && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Edit3 className="size-4" />
                {t("patients.edit")}
              </Button>
            )}
            {patient.actions.deactivate && (
              <Button variant="outline" onClick={() => setStatusTarget(patient)}>
                {patient.status === "active" ? (
                  <Archive className="size-4" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                {t(patient.status === "active" ? "patients.archive" : "patients.restore")}
              </Button>
            )}
          </div>
        }
      />
      <PatientFileTabs
        patientId={patient.id}
        patientStatus={patient.status}
        extraTabs={extraTabs}
        overview={
          <>
            <dl className="grid max-w-3xl gap-x-8 rounded-lg border bg-card sm:grid-cols-2">
              {rows.map(([label, value, ltr]) => (
                <div key={label} className="flex flex-col gap-1 border-b px-4 py-3 last:border-b-0">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium">
                    <span className="inline-block" {...(ltr ? { dir: "ltr" as const } : {})}>
                      {value}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4" />
              {t("patients.detailAudited")}
            </p>
          </>
        }
      />
      <PatientFormDialog open={editing} patient={patient} onOpenChange={setEditing} />
      <PatientStatusDialog patient={statusTarget} onClose={() => setStatusTarget(null)} />
    </div>
  );
}
