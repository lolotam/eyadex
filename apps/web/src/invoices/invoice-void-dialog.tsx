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

/**
 * The void confirm. It holds the invoice it was opened on: confirming sends that version, so another user's
 * edit meanwhile answers version_conflict instead of being voided unseen (PR #78 review).
 */
export function InvoiceVoidDialog({ invoice, onClose, onVoided }: Props) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const [reason, setReason] = useState("");
  const voidIt = useMutation({
    mutationFn: (inv: Invoice) =>
      api.finance.voidInvoice(persona, inv.id, inv.version, reason.trim()),
    onSuccess: () => {
      onVoided();
      toast.success(t("finance.detail.voided"));
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
        {invoice && releasesOnVoid(invoice) && <ReleaseWarning />}
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
            disabled={!reason.trim() || voidIt.isPending}
            onClick={() => invoice && voidIt.mutate(invoice)}
          >
            {t("finance.detail.void")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
