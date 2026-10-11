import { useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { FileCheck2, Printer, XCircle } from "lucide-react";
import type { VisitDetail } from "@eyadex/contracts/visits";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ConfirmActionDialog } from "@/shared/shell/confirm-action-dialog";
import { PrescriptionPrintDialog } from "./prescription-print-dialog";
import { useVisitWrite } from "./use-visit-write";
import { VisitCancelDialog } from "./visit-cancel-dialog";
import { noteSaveKey, type NoteFlush } from "./visit-note-save";

/**
 * Sign · Cancel draft · Print, each following `can` (UX only: the API refuses as well). Sign first
 * saves the note's pending edits (`flushNote`) and signs only when that save succeeded.
 */
export function VisitActions({ detail, flushNote }: { detail: VisitDetail; flushNote: NoteFlush }) {
  const { t } = useI18n();
  const id = detail.visit.id;
  const noteSaving = useIsMutating({ mutationKey: noteSaveKey(id) }) > 0;
  const [flushing, setFlushing] = useState(false);
  const [confirmSign, setConfirmSign] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [printing, setPrinting] = useState(false);
  const sign = useVisitWrite<void>(id, (api, persona) => api.signVisit(persona, id), {
    success: "visit.signed",
    onDone: () => setConfirmSign(false),
  });
  const printable = detail.content !== null && detail.visit.status !== "cancelled";
  const confirm = async () => {
    setFlushing(true);
    try {
      await flushNote();
    } catch {
      // The note save already showed its error; the dialog stays open and nothing is signed.
      return;
    } finally {
      setFlushing(false);
    }
    sign.mutate();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {detail.can.sign && (
        <Button onClick={() => setConfirmSign(true)} disabled={noteSaving}>
          <FileCheck2 className="size-4" />
          {t("visit.sign")}
        </Button>
      )}
      {detail.can.cancel && (
        <Button variant="outline" onClick={() => setCancelling(true)}>
          <XCircle className="size-4" />
          {t("visit.cancel")}
        </Button>
      )}
      {printable && (
        <Button variant="outline" onClick={() => setPrinting(true)}>
          <Printer className="size-4" />
          {t("visit.print")}
        </Button>
      )}
      <ConfirmActionDialog
        open={confirmSign}
        title={t("visit.signTitle")}
        body={t("visit.signBody")}
        confirmLabel={t("visit.sign")}
        cancelLabel={t("common.cancel")}
        pending={flushing || noteSaving || sign.isPending}
        onConfirm={() => void confirm()}
        onClose={() => setConfirmSign(false)}
      />
      <VisitCancelDialog visitId={id} open={cancelling} onOpenChange={setCancelling} />
      {printing && (
        <PrescriptionPrintDialog visitId={id} open={printing} onOpenChange={setPrinting} />
      )}
    </div>
  );
}
