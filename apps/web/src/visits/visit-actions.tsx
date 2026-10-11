import { useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { FileCheck2, Printer, XCircle } from "lucide-react";
import type { VisitDetail } from "@eyadex/contracts/visits";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ConfirmActionDialog } from "@/shared/shell/confirm-action-dialog";
import { PrescriptionPrintDialog } from "./prescription-print-dialog";
import { useSectionSaveRefusal, useVisitWrite } from "./use-visit-write";
import { VisitCancelDialog } from "./visit-cancel-dialog";
import { sectionSaveKey } from "./visit-section-saves";

/**
 * Sign · Cancel draft · Print, each following `can` (UX only: the API refuses as well). Sign is off
 * while any section save runs; its confirm waits for every section save, sends the note's pending text
 * and the list forms' unsaved edits through their own saves (`settleSaves`), and signs only when each
 * section's last save succeeded (a list whose edits do not validate refuses, naming its section).
 * Cancel draft follows the same rule.
 */
export function VisitActions({
  detail,
  settleSaves,
}: {
  detail: VisitDetail;
  settleSaves: () => Promise<void>;
}) {
  const { t } = useI18n();
  const id = detail.visit.id;
  const sectionSaving = useIsMutating({ mutationKey: sectionSaveKey(id) }) > 0;
  const [flushing, setFlushing] = useState(false);
  const [confirmSign, setConfirmSign] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [printing, setPrinting] = useState(false);
  const sign = useVisitWrite<void>(id, (api, persona) => api.signVisit(persona, id), {
    success: "visit.signed",
    onDone: () => setConfirmSign(false),
  });
  const refused = useSectionSaveRefusal(id);
  const signBusy = flushing || sign.isPending;
  // Closing while the confirm waits would not stop the sign it is about to send, so it is refused
  // (as `VisitCancelDialog`).
  const closeSign = () => {
    if (!signBusy) setConfirmSign(false);
  };
  const printable = detail.content !== null && detail.visit.status !== "cancelled";
  const confirm = async () => {
    setFlushing(true);
    try {
      await settleSaves();
    } catch (e) {
      // The dialog stays open and nothing is signed.
      refused(e);
      return;
    } finally {
      setFlushing(false);
    }
    sign.mutate();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {detail.can.sign && (
        <Button onClick={() => setConfirmSign(true)} disabled={sectionSaving}>
          <FileCheck2 className="size-4" />
          {t("visit.sign")}
        </Button>
      )}
      {detail.can.cancel && (
        <Button variant="outline" onClick={() => setCancelling(true)} disabled={sectionSaving}>
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
        // A save still running is not a reason to refuse the confirm: the confirm waits for it.
        pending={signBusy}
        onConfirm={() => void confirm()}
        onClose={closeSign}
      />
      <VisitCancelDialog
        visitId={id}
        open={cancelling}
        onOpenChange={setCancelling}
        settleSaves={settleSaves}
      />
      {printing && (
        <PrescriptionPrintDialog visitId={id} open={printing} onOpenChange={setPrinting} />
      )}
    </div>
  );
}
