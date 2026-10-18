import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useClinicMoney } from "@/shared/money/use-clinic-money";
import { canAtBranch } from "@/shared/permissions/can-at-branch";
import { can } from "@/shared/permissions/can";
import { Button } from "@/components/ui/button";
import { RequirePermission } from "@/shared/permissions/require-permission";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { InvoiceForm } from "./invoice-form";
import { valuesFromDraft, type InvoiceFormValues } from "./invoice-form-draft";
import { useInvoiceDraft, useRefreshInvoices, useSourceInvoice } from "./invoice-queries";

type Source = { source: "appointment" | "visit"; sourceId: string } | null;

const EMPTY: InvoiceFormValues = {
  patientId: null,
  branchId: null,
  lines: [],
  invoiceDiscount: null,
};

/**
 * `/clinic/invoices/new`: a manual invoice, or one for an appointment or visit (ids only in the URL).
 * A source that already has an issued invoice opens that invoice instead.
 */
export function NewInvoicePage({ source }: { source: Source }) {
  return (
    <RequirePermission action="create" resource="invoices">
      <NewInvoiceContent source={source} />
    </RequirePermission>
  );
}

function NewInvoiceContent({ source }: { source: Source }) {
  const { t, tDynamic } = useI18n();
  const navigate = useNavigate();
  const { session } = useSession();
  const money = useClinicMoney();
  const refresh = useRefreshInvoices();
  const existing = useSourceInvoice(
    source?.source ?? "visit",
    source?.sourceId ?? "",
    source !== null && can(session?.permissions ?? [], "view", "invoices"),
  );
  const draft = useInvoiceDraft(source?.source ?? null, source?.sourceId ?? null);
  const found = existing.data ?? null;
  useEffect(() => {
    if (found)
      void navigate({
        to: "/clinic/invoices/$invoiceId",
        params: { invoiceId: found.id },
        replace: true,
      });
  }, [found, navigate]);

  const loading =
    money.exponent === null ||
    (source !== null && (existing.isLoading || draft.isLoading || found));
  const failed =
    money.settings.error ?? (existing.data === undefined ? existing.error : null) ?? draft.error;
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("finance.invoice.newTitle")} subtitle="" />
      {failed ? (
        <StatusPanel
          icon={AlertCircle}
          title={t("finance.invoice.draftError")}
          body={tDynamic(`errors.${errorCodeOf(failed)}`)}
          action={
            <Button
              onClick={() => {
                void money.settings.refetch();
                if (existing.isError) void existing.refetch();
                if (draft.isError) void draft.refetch();
              }}
            >
              {t("common.tryAgain")}
            </Button>
          }
        />
      ) : loading ? (
        <LoadingBlock />
      ) : (
        <InvoiceForm
          initial={draft.data ? valuesFromDraft(draft.data, money.exponent!) : EMPTY}
          source={source}
          editing={null}
          mayDiscountAt={(branchId) =>
            !!session && branchId !== null && canAtBranch(session, "create", "discounts", branchId)
          }
          priceMissing={draft.data?.priceMissing ?? false}
          onDone={(invoice) => {
            refresh();
            if (session && canAtBranch(session, "view", "invoices", invoice.branchId)) {
              void navigate({
                to: "/clinic/invoices/$invoiceId",
                params: { invoiceId: invoice.id },
              });
            } else {
              toast.success(t("finance.invoice.issued", { number: invoice.number }));
              if (window.history.length > 1) window.history.back();
              else void navigate({ to: "/clinic" });
            }
          }}
        />
      )}
    </div>
  );
}
