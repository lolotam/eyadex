import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Archive, ArrowLeft, Edit3, RotateCcw, ShieldCheck } from "lucide-react";
import { formatFileNumber } from "@contracts/patients";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { RequirePermission } from "@/shared/permissions/require-permission";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { PatientFormDialog } from "./patient-form-dialog";
import { usePatientDetail } from "./patient-queries";
import { PatientStatusBadge } from "./patient-status-badge";
import { PatientStatusDialog, type PatientStatusTarget } from "./patient-status-dialog";

export function PatientDetailPage({ patientId }: { patientId: string }) {
  return (
    <RequirePermission resource="patients">
      <PatientDetail patientId={patientId} />
    </RequirePermission>
  );
}

function BackLink() {
  const { t } = useI18n();
  return (
    <Button variant="ghost" size="sm" asChild className="mb-3 -ms-2">
      <Link to="/clinic/patients">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("patients.backToList")}
      </Link>
    </Button>
  );
}

function PatientDetail({ patientId }: { patientId: string }) {
  const { t, pick, lang } = useI18n();
  const { session } = useSession();
  const detail = usePatientDetail(patientId);
  const [editing, setEditing] = useState(false);
  const [statusTarget, setStatusTarget] = useState<PatientStatusTarget | null>(null);
  const permissions = session?.permissions ?? [];

  if (detail.isLoading) return <LoadingBlock />;
  const patient = detail.data;
  if (!patient)
    return (
      <div>
        <BackLink />
        <StatusPanel icon={AlertCircle} title={t("patients.detailError")} body={t("errors.not_found")} />
      </div>
    );

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en-GB", { dateStyle: "medium" }).format(
      new Date(iso),
    );
  const rows: [string, string, boolean?][] = [
    [t("patients.columns.fileNumber"), formatFileNumber(patient.fileNumber), true],
    [t("patients.fields.phone"), patient.phone, true],
    [t("patients.fields.birthDate"), fmtDate(`${patient.birthDate}T00:00:00Z`)],
    [t("patients.fields.gender"), t(`patients.gender.${patient.gender}`)],
    [t("patients.fields.branch"), pick(patient.branchNameAr, patient.branchNameEn)],
    [t("patients.fields.civilId"), patient.civilId ?? t("patients.none"), true],
    [t("patients.fields.createdAt"), fmtDate(patient.createdAt)],
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
            {can(permissions, "update", "patients") && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Edit3 className="size-4" />
                {t("patients.edit")}
              </Button>
            )}
            {can(permissions, "deactivate", "patients") && (
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
      <dl className="grid max-w-3xl gap-x-8 rounded-lg border bg-card sm:grid-cols-2">
        {rows.map(([label, value, ltr]) => (
          <div key={label} className="flex flex-col gap-1 border-b px-4 py-3 last:border-b-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm font-medium" {...(ltr ? { dir: "ltr" as const } : {})}>
              <span className="inline-block">{value}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4" />
        {t("patients.detailAudited")}
      </p>
      <PatientFormDialog open={editing} patient={patient} onOpenChange={setEditing} />
      <PatientStatusDialog patient={statusTarget} onClose={() => setStatusTarget(null)} />
    </div>
  );
}
