import { useEffect, useRef, useState } from "react";
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

/**
 * What a click carries: the invoice to void, whether its release warning was already shown, and the
 * reason as it was typed at that click. The reason travels with the click, so what the void sends is
 * what the user confirmed and not whatever the field holds when the request finally goes out
 * (PR #110 review).
 */
type Confirm = { invoice: Invoice; warningShown: boolean; reason: string };

/**
 * A confirming click with the paid amount it carried: the API refuses a void whose confirmed amount
 * is not the invoice's paid amount any more (issue #113).
 */
type VoidRequest = Confirm & { expectedPaidMinor: string };

/**
 * The void confirm. It holds the invoice it was opened on: confirming sends that version, so another user's
 * edit meanwhile answers version_conflict instead of being voided unseen (PR #78 review).
 *
 * A recorded payment does not bump that version, so the invoice is read again before every void: when
 * money is paid on it now, the release warning comes first and only the next click voids it (issue #107).
 * The void carries the paid amount of that read, so the API can refuse it when the invoice was paid more
 * in between (issue #113).
 *
 * The reason field is locked while a void is on its way, and the confirming click carries the reason
 * it was given: an edit made in between cannot rewrite what the void records.
 *
 * While that void is on its way the dialog cannot be closed, and a read that answers after the
 * dialog was closed voids nothing: the user cannot walk away from a void they did not see
 * (PR #110 review).
 */
export function InvoiceVoidDialog({ invoice, onClose, onVoided }: Props) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const [reason, setReason] = useState("");
  // The warning belongs to the invoice it was shown for: opening another invoice starts it over.
  const [warnedId, setWarnedId] = useState<string | null>(null);
  const warningShown = invoice !== null && (releasesOnVoid(invoice) || warnedId === invoice.id);
  // The invoice the dialog shows right now: a read that answers after the dialog was closed must
  // not void that invoice (PR #110 review). The ref is the only value the read's answer can trust:
  // the state it reads is a render away.
  const openId = useRef<string | null>(invoice?.id ?? null);
  useEffect(() => {
    openId.current = invoice?.id ?? null;
  }, [invoice?.id]);
  // A read that only refreshes the warning: after the API refused the void, the dialog stays open and
  // the warning must show the amount the invoice carries now (issue #113).
  const refresh = useMutation({
    mutationFn: (confirm: Confirm) => api.finance.getInvoice(persona, confirm.invoice.id),
    onSuccess: (fresh, confirm) => {
      if (releasesOnVoid(fresh)) setWarnedId(confirm.invoice.id);
    },
    onError: (e) => toast.error(tDynamic(`errors.${errorKeyOf(e)}`)),
  });
  const voidIt = useMutation({
    // The reason is the one the confirming click carried, trimmed: a void records what was confirmed.
    mutationFn: (request: VoidRequest) =>
      api.finance.voidInvoice(
        persona,
        request.invoice.id,
        request.invoice.version,
        request.reason.trim(),
        request.expectedPaidMinor,
      ),
    onSuccess: () => {
      onVoided();
      toast.success(t("finance.detail.voided"));
    },
    onError: (e, request) => {
      toast.error(tDynamic(`errors.${errorKeyOf(e)}`));
      // The invoice was paid more after the amount was confirmed: read it again so the warning shows
      // the new amount, and leave the dialog open for the next confirming click.
      if (errorKeyOf(e) === "invoice_paid_changed") refresh.mutate(request);
    },
  });
  const reread = useMutation({
    mutationFn: (confirm: Confirm) => api.finance.getInvoice(persona, confirm.invoice.id),
    onSuccess: (fresh, confirm) => {
      // The dialog was closed while the invoice was read again: the user walked away, so nothing is
      // voided now (PR #110 review).
      if (openId.current !== confirm.invoice.id) return;
      // Money paid since the dialog opened becomes the patient's credit on void, so the warning comes
      // first and the void waits for the next click.
      if (releasesOnVoid(fresh) && !confirm.warningShown) {
        setWarnedId(confirm.invoice.id);
        return;
      }
      // The void carries the amount this read showed, so the API refuses it when the invoice was paid
      // more in between (issue #113).
      voidIt.mutate({ ...confirm, expectedPaidMinor: fresh.settlement?.paidMinor ?? "0" });
    },
    onError: (e) => toast.error(tDynamic(`errors.${errorKeyOf(e)}`)),
  });
  // A void is being prepared or sent: the reason must stay what the user confirmed.
  const busy = reread.isPending || voidIt.isPending || refresh.isPending;
  return (
    <Dialog
      open={invoice !== null}
      onOpenChange={(open) => {
        // A void is on its way: the dialog must not close, or the read that is still running would
        // void the invoice after the user walked away (PR #110 review). The close button, Escape
        // and a click outside all come through here, so they all do nothing while the void runs.
        if (busy) return;
        if (!open) onClose();
      }}
    >
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
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            variant="destructive"
            disabled={!reason.trim() || busy}
            onClick={() => invoice && reread.mutate({ invoice, warningShown, reason })}
          >
            {t("finance.detail.void")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
