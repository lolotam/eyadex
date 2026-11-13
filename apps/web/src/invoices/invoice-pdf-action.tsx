import { useEffect, useId, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileDown, LoaderCircle } from "lucide-react";
import type { WebErrorCode } from "@eyadex/contracts/common";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { closePdfTab, openPdfTab, showPdf } from "./invoice-pdf-tab";

type Props = {
  invoiceId: string;
  onErrorChange: (code: WebErrorCode | null) => void;
};

/** The synchronous download contract: pending work stays visible and retries are explicit. */
export function InvoicePdfAction({ invoiceId, onErrorChange }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const statusId = useId();
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const pendingTab = useRef<Window | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      closePdfTab(pendingTab.current);
      pendingTab.current = null;
    };
  }, []);
  const pdf = useMutation({
    mutationFn: (_tab: Window | null) => api.finance.pdf(persona, invoiceId),
    onMutate: () => {
      if (mounted.current) onErrorChange(null);
    },
    onSuccess: (blob, tab) => {
      if (!mounted.current) return;
      pendingTab.current = null;
      showPdf(tab, blob, `${invoiceId}.pdf`);
    },
    onError: (error, tab) => {
      closePdfTab(tab);
      pendingTab.current = null;
      if (mounted.current) onErrorChange(errorCodeOf(error));
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pdf.isPending}
        aria-busy={pdf.isPending}
        aria-describedby={pdf.isPending ? statusId : undefined}
        onClick={() => {
          // The ref also blocks a second click before React renders the disabled state.
          if (inFlight.current) return;
          inFlight.current = true;
          const tab = openPdfTab();
          pendingTab.current = tab;
          pdf.mutate(tab);
        }}
      >
        {pdf.isPending ? (
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <FileDown className="size-4" aria-hidden />
        )}
        {t(pdf.isError ? "finance.detail.pdfRetry" : "finance.detail.pdf")}
      </Button>
      {pdf.isPending && (
        <span
          id={statusId}
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {t("finance.detail.pdfPreparing")}
        </span>
      )}
    </>
  );
}
