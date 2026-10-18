import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import { formatFileNumber } from "@eyadex/contracts/patients";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { useEncounterSlots } from "@/shared/shell/encounter-slots";
import { AttachmentsPanel } from "./attachments-panel";
import { useVisit } from "./medical-queries";
import { VisitActions } from "./visit-actions";
import { VisitAddenda } from "./visit-addenda";
import { VisitCancelDetails } from "./visit-cancel-details";
import { VisitDiagnoses } from "./visit-diagnoses";
import { VisitNoteEditor } from "./visit-note-editor";
import { SectionSaves, type NoteFlush } from "./visit-section-saves";
import { VisitPrescription } from "./visit-prescription";
import { VisitPrescriptionEmail } from "./visit-prescription-email";
import { VisitStatusBadge } from "./visit-status-badge";

/** The visit: header, the notes, diagnoses, prescription, addenda and attachments, by `can`. */
export function VisitContent({ visitId }: { visitId: string }) {
  const { t, pick, formatDate } = useI18n();
  const slots = useEncounterSlots();
  const { session } = useSession();
  const query = useVisit(visitId);
  // The page owns the note's flush and every section save, so Sign sends the pending note text and
  // waits for all of them before it locks the visit (the sections register themselves).
  const noteFlush = useRef<NoteFlush | null>(null);
  const [saves] = useState(() => new SectionSaves());
  const settleSaves = () => saves.settle(() => noteFlush.current?.() ?? Promise.resolve());
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
            <VisitActions detail={d} settleSaves={settleSaves} />
            {visit.status !== "cancelled" && (
              slots.visitActions?.({
                id: visit.id,
                appointmentId: visit.appointmentId,
                branchId: visit.branchId,
              })
            )}
          </div>
        }
      />
      {note && (
        <p className="mb-4 flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          {note}
        </p>
      )}
      {visit.cancelReason !== null && (
        <VisitCancelDetails reason={visit.cancelReason} note={content?.cancelNote ?? null} />
      )}
      {content === null ? (
        <>
          <StatusPanel icon={ShieldCheck} title={t("visits.contentHidden")} body="" />
          {d.can.attach && (
            // The upload's own rule (the API's `mayAttach`) holds without the content: such a caller
            // adds files to the visit but cannot list them, so neither can it pick one to archive.
            <div className="mt-4">
              <AttachmentsPanel
                patientId={visit.patientId}
                visitId={visit.id}
                canUpload
                canArchive={false}
                canView={false}
              />
            </div>
          )}
        </>
      ) : (
        <div className="grid max-w-4xl gap-4">
          <VisitNoteEditor
            visitId={visit.id}
            note={content.note}
            editable={editable}
            flushRef={noteFlush}
            saves={saves}
          />
          <VisitDiagnoses
            visitId={visit.id}
            diagnoses={content.diagnoses}
            editable={editable}
            saves={saves}
          />
          <VisitPrescription
            visitId={visit.id}
            items={content.prescription}
            editable={editable}
            saves={saves}
          />
          <VisitAddenda visitId={visit.id} addenda={content.addenda} canAdd={d.can.addAddendum} />
          {visit.status === "signed" && content.prescription.length > 0 && (
            <VisitPrescriptionEmail visitId={visit.id} />
          )}
          <AttachmentsPanel
            patientId={visit.patientId}
            visitId={visit.id}
            canUpload={d.can.attach}
          />
        </div>
      )}
      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4" />
        {t("visits.audited")}
      </p>
    </div>
  );
}
