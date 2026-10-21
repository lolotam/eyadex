import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Invoice } from "@eyadex/contracts/finance";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { errorKeyOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { ReleaseWarning } from "./release-warning";
import { releasesOnVoid } from "./invoice-release-warning";

type Props = { invoice: Invoice | null; onClose: () => void; onVoided: () => void };

/** What a click carries: the invoice to void, and whether its release warning was already shown. */
type Confirm = { invoice: Invoice; warningShown: boolean };

/**
 * The void confirm. It holds the invoice it was opened on: confirming sends that version, so another user's
 * edit meanwhile answers version_conflict instead of being voided unseen (PR #78 review).
 *
 * A recorded payment does not bump that version, so the invoice is read again before every void: when
 * money is paid on it now, the release warning comes first and only the next click voids it (issue #107).
 */
export function InvoiceVoidDialog({ invoice, onClose, onVoided }: Props) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const [reason, setReason] = useState("");
  // The warning belongs to the invoice it was shown for: opening another invoice starts it over.
  const [warnedId, setWarnedId] = useState<string | null>(null);
  const warningShown = invoice !== null && (releasesOnVoid(invoice) || warnedId === invoice.id);
  const voidIt = useMutation({
    mutationFn: (inv: Invoice) =>
      api.finance.voidInvoice(persona, inv.id, inv.version, reason.trim()),
    onSuccess: () => {
      onVoided();
      toast.success(t("finance.detail.voided"));
    },
    onError: (e) => toast.error(tDynamic(`errors.${errorKeyOf(e)}`)),
  });
  const reread = useMutation({
    mutationFn: (confirm: Confirm) => api.finance.getInvoice(persona, confirm.invoice.id),
    onSuccess: (fresh, confirm) => {
      // Money paid since the dialog opened becomes the patient's credit on void, so the warning comes
      // first and the void waits for the next click.
      if (releasesOnVoid(fresh) && !confirm.warningShown) {
        setWarnedId(confirm.invoice.id);
        return;
      }
      voidIt.mutate(confirm.invoice);
    },
    onError: (e) => toast.error(tDynamic(`errors.${errorKeyOf(e)}`)),
  });
  return (
    <Dialog open={invoice !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("finance.detail.voidTitle", { number: invoice?.number ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("finance.detail.voidBody")}</DialogDescription>
        </DialogHeader>
        {warningShown && <ReleaseWarning />}
        <Textarea
          value={reason}
          maxLength={300}
          aria-label={t("finance.detail.voidReason")}
          placeholder={t("finance.detail.voidReason")}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            variant="destructive"
            disabled={!reason.trim() || reread.isPending || voidIt.isPending}
            onClick={() => invoice && reread.mutate({ invoice, warningShown })}
          >
            {t("finance.detail.void")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
