import { useState } from "react";
import { AlertCircle, Banknote, Wallet } from "lucide-react";
import type { Invoice } from "@eyadex/contracts/finance";
import { formatMinor, readMinor } from "@eyadex/contracts/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorKeyOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useFinanceSettings } from "@/shared/money/use-clinic-money";
import { canAtBranch } from "@/shared/permissions/can-at-branch";
import { useSession } from "@/shared/persona/persona-provider";
import { StatusPanel } from "@/shared/shell/status-panel";
import { ApplyCreditForm } from "./apply-credit-dialog";
import { InvoiceMovements } from "./invoice-movements";
import { useInvoicePayments, useRefreshPayments } from "./payment-queries";
import { RecordPaymentForm } from "./record-payment-dialog";

type Props = { invoice: Invoice; onChanged: () => void };

const positive = (minor: string | undefined) => (readMinor(minor ?? "0") ?? 0n) > 0n;

/**
 * The «الدفع» panel of an invoice (F2 card 1 §2). Paid and balance due are on the totals already; this
 * shows the movements and the actions, each judged at the invoice's own branch (F2-Q8). A doctor with only
 * `view:invoices:own` sees nothing here and no movements request is sent.
 */
export function InvoicePaymentPanel({ invoice, onChanged }: Props) {
  const { t, tDynamic } = useI18n();
  const { session } = useSession();
  const settings = useFinanceSettings();
  const refreshPayments = useRefreshPayments();
  // The dialog keeps the invoice and credit it was opened on: a refetch never changes what it checks.
  const [open, setOpen] = useState<{
    kind: "pay" | "credit";
    invoice: Invoice;
    credit: string;
  } | null>(null);
  const at = (action: "view" | "create") =>
    !!session && canAtBranch(session, action, "payments", invoice.branchId);
  const mayView = at("view");
  const query = useInvoicePayments(invoice.id, mayView);
  const owes = invoice.status === "issued" && positive(invoice.settlement?.owedMinor);
  const credit = query.data?.creditBalanceMinor ?? "0";
  const mayPay = at("create") && owes;
  const mayCredit = mayPay && positive(credit);
  if (!mayView && !mayPay) return null;
  const format = (minor: string) =>
    `${formatMinor(minor, invoice.currencyExponent)} ${invoice.currency}`;
  // Absent switches mean on: the API's own "no saved switch = on" rule (spec §4.6).
  const methods = (settings.data?.paymentMethods ?? [])
    .filter((m) => m.enabled)
    .map((m) => m.method);
  const enabled = settings.data?.paymentMethods
    ? methods
    : (["cash", "knet", "bank_transfer", "other"] as const).slice();
  const done = () => {
    setOpen(null);
    onChanged();
    refreshPayments();
  };
  return (
    <section className="mt-6 flex flex-col gap-3" aria-labelledby="invoice-payment-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="invoice-payment-title" className="text-base font-semibold">
          {t("payments.panel.title")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {mayPay && (
            <Button size="sm" onClick={() => setOpen({ kind: "pay", invoice, credit })}>
              <Banknote className="size-4" />
              {t("payments.panel.record")}
            </Button>
          )}
          {mayCredit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpen({ kind: "credit", invoice, credit })}
            >
              <Wallet className="size-4" />
              {t("payments.panel.useCredit")}
            </Button>
          )}
        </div>
      </div>
      {mayView &&
        (query.isError ? (
          <StatusPanel
            icon={AlertCircle}
            title={t("payments.panel.loadError")}
            body={tDynamic(`errors.${errorKeyOf(query.error)}`)}
            action={<Button onClick={() => void query.refetch()}>{t("common.tryAgain")}</Button>}
          />
        ) : query.data ? (
          <>
            {positive(query.data.creditBalanceMinor) && (
              <p className="text-sm">
                <span className="text-muted-foreground">{t("payments.panel.credit")}: </span>
                <span className="font-medium tabular-nums">
                  {format(query.data.creditBalanceMinor)}
                </span>
              </p>
            )}
            <InvoiceMovements data={query.data} format={format} />
          </>
        ) : (
          <div className="h-16 animate-pulse rounded-md bg-muted" aria-busy="true" />
        ))}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(
                open?.kind === "credit"
                  ? "payments.dialog.creditTitle"
                  : "payments.dialog.recordTitle",
                {
                  number: invoice.number,
                },
              )}
            </DialogTitle>
          </DialogHeader>
          {open?.kind === "pay" && (
            <RecordPaymentForm invoice={open.invoice} methods={enabled} onDone={done} />
          )}
          {open?.kind === "credit" && (
            <ApplyCreditForm invoice={open.invoice} creditMinor={open.credit} onDone={done} />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
