import { useEffect, useId, useRef, useState } from "react";
import { FileDown, LoaderCircle } from "lucide-react";
import type { WebErrorCode } from "@eyadex/contracts/common";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { closePdfTab, openPdfTab, showPdf } from "@/shared/pdf/pdf-tab";

/** Keep each download bound to its receipt and caller, including late network answers. */
export function ReceiptPdfAction({ paymentId }: { paymentId: string }) {
  const api = useApi();
  const { persona } = usePersona();
  const { t, tDynamic } = useI18n();
  const statusId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WebErrorCode | null>(null);
  const active = useRef<{ tab: Window | null } | null>(null);
  useEffect(() => {
    setPending(false);
    setError(null);
    return () => {
      closePdfTab(active.current?.tab ?? null);
      active.current = null;
    };
  }, [paymentId, persona.kind, persona.clinicId, persona.memberId]);

  async function download() {
    if (active.current) return;
    const attempt = { tab: openPdfTab() };
    active.current = attempt;
    setPending(true);
    setError(null);
    try {
      const file = await api.payments.pdf(persona, paymentId);
      if (active.current !== attempt) return;
      showPdf(attempt.tab, file, `${paymentId}.pdf`);
    } catch (cause) {
      closePdfTab(attempt.tab);
      if (active.current === attempt) setError(errorCodeOf(cause));
    } finally {
      if (active.current === attempt) {
        active.current = null;
        setPending(false);
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        disabled={pending}
        aria-busy={pending}
        aria-describedby={pending ? statusId : undefined}
        onClick={() => void download()}
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <FileDown className="size-4" aria-hidden />
        )}
        {t(error ? "payments.receipts.pdfRetry" : "payments.receipts.pdf")}
      </Button>
      {pending && (
        <span
          id={statusId}
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {t("payments.receipts.pdfPreparing")}
        </span>
      )}
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {tDynamic(`errors.${error}`)}
        </span>
      )}
    </div>
  );
}
