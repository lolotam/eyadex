import { useRef } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import { formatFileNumber } from "@eyadex/contracts/patients";
import { AttachmentsPanel } from "@/medical/attachments-panel";
import { useVisit } from "@/medical/medical-queries";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { VisitActions } from "./visit-actions";
import { VisitAddenda } from "./visit-addenda";
import { VisitDiagnoses } from "./visit-diagnoses";
import { VisitNoteEditor } from "./visit-note-editor";
import type { NoteFlush } from "./visit-note-save";
import { VisitPrescription } from "./visit-prescription";
import { VisitStatusBadge } from "./visit-status-badge";

/** The visit: header, the notes, diagnoses, prescription, addenda and attachments, by `can`. */
export function VisitContent({ visitId }: { visitId: string }) {
  const { t, pick, formatDate } = useI18n();
  const { session } = useSession();
  const query = useVisit(visitId);
  // The page owns the note's flush so Sign can save pending edits first (the editor registers it).
  const noteFlush = useRef<NoteFlush | null>(null);
  if (query.isLoading) return <LoadingBlock />;
  if (query.isError || !query.data) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("visit.loadError")}
        body={t(`errors.${errorCodeOf(query.error)}`)}
      />
    );
  }
  const d = query.data;
  const { visit, content } = d;
  const editable = d.can.edit;
  const note =
    visit.status === "signed"
      ? t("visit.lockedNote")
      : visit.status === "cancelled"
        ? t("visit.cancelledNote")
        : !editable && content
          ? t("visit.readOnly")
          : null;
  return (
    <div>
      {can(session?.permissions ?? [], "view", "patients") && (
        <Link
          to="/clinic/patients/$patientId"
          params={{ patientId: visit.patientId }}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {d.patient.fullName}
        </Link>
      )}
      <PageHeader
        title={d.patient.fullName}
        subtitle={[
          formatFileNumber(d.patient.fileNumber),
          pick(d.branch.nameAr, d.branch.nameEn),
          visit.providerName,
          formatDate(visit.startedAt),
        ].join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <VisitStatusBadge status={visit.status} />
            <VisitActions detail={d} flushNote={() => noteFlush.current?.() ?? Promise.resolve()} />
          </div>
        }
      />
      {note && (
        <p className="mb-4 flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          {note}
        </p>
      )}
      {content === null ? (
        <StatusPanel icon={ShieldCheck} title={t("visits.contentHidden")} body="" />
      ) : (
        <div className="grid max-w-4xl gap-4">
          <VisitNoteEditor
            visitId={visit.id}
            note={content.note}
            editable={editable}
            flushRef={noteFlush}
          />
          <VisitDiagnoses visitId={visit.id} diagnoses={content.diagnoses} editable={editable} />
          <VisitPrescription visitId={visit.id} items={content.prescription} editable={editable} />
          <VisitAddenda visitId={visit.id} addenda={content.addenda} canAdd={d.can.addAddendum} />
          <AttachmentsPanel patientId={visit.patientId} visitId={visit.id} canUpload={editable} />
        </div>
      )}
      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4" />
        {t("visits.audited")}
      </p>
    </div>
  );
}
