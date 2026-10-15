import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useClinicMoney } from "@/shared/money/use-clinic-money";
import { can } from "@/shared/permissions/can";
import { RequirePermission } from "@/shared/permissions/require-permission";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { InvoiceForm } from "./invoice-form";
import { valuesFromDraft, type InvoiceFormValues } from "./invoice-form-draft";
import { useInvoiceDraft, useRefreshInvoices, useSourceInvoice } from "./invoice-queries";

type Source = { source: "appointment" | "visit"; sourceId: string } | null;

const EMPTY: InvoiceFormValues = { patientId: null, branchId: null, lines: [], invoiceDiscount: null };

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
  const existing = useSourceInvoice(source?.source ?? "visit", source?.sourceId ?? "", source !== null);
  const draft = useInvoiceDraft(source?.source ?? null, source?.sourceId ?? null);
  const found = existing.data ?? null;
  useEffect(() => {
    if (found) void navigate({ to: "/clinic/invoices/$invoiceId", params: { invoiceId: found.id }, replace: true });
  }, [found, navigate]);

  const loading =
    money.exponent === null || (source !== null && (existing.isLoading || draft.isLoading || found));
  const failed = money.settings.error ?? draft.error;
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("finance.invoice.newTitle")} subtitle="" />
      {failed ? (
        <StatusPanel
          icon={AlertCircle}
          title={t("finance.invoice.draftError")}
          body={tDynamic(`errors.${errorCodeOf(failed)}`)}
        />
      ) : loading ? (
        <LoadingBlock />
      ) : (
        <InvoiceForm
          initial={draft.data ? valuesFromDraft(draft.data, money.exponent!) : EMPTY}
          source={source}
          editing={null}
          mayDiscount={can(session?.permissions ?? [], "create", "discounts")}
          priceMissing={draft.data?.priceMissing ?? false}
          onDone={(invoice) => {
            refresh();
            void navigate({ to: "/clinic/invoices/$invoiceId", params: { invoiceId: invoice.id } });
          }}
        />
      )}
    </div>
  );
}
