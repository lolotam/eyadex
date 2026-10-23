import { useState } from "react";
import { AlertCircle, Banknote, Undo2, Wallet } from "lucide-react";
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
import { useHeldKeys } from "./idempotency-key";
import { InvoiceMovements } from "./invoice-movements";
import { useInvoicePayments, useRefreshPayments } from "./payment-queries";
import { RecordPaymentForm } from "./record-payment-dialog";
import { RefundForm, type RefundSource } from "./refund-form";
import { useRefundKeys } from "./refund-keys";

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
  const [open, setOpen] = useState<
    | { kind: "pay" | "credit"; invoice: Invoice; credit: string }
    | { kind: "refund"; invoice: Invoice; source: RefundSource }
    | null
  >(null);
  const [pending, setPending] = useState(false);
  const at = (action: "view" | "create") =>
    !!session && canAtBranch(session, action, "payments", invoice.branchId);
  const mayView = at("view");
  const query = useInvoicePayments(invoice.id, invoice.version, mayView);
  // The held key is bound to the invoice as it is now, not to the copy the dialog was opened on: a
  // refetch that shows a higher paid amount means the earlier request may have been recorded, so its key
  // must not answer a new payment.
  const keys = useHeldKeys({
    invoiceId: invoice.id,
    paidMinor: invoice.settlement?.paidMinor ?? "0",
  });
  // Refund keys are held per invoice and source, never bound to the paid amount a refund itself lowers.
  const refundKeys = useRefundKeys();
  const mayRefund =
    mayView && !!session && canAtBranch(session, "create", "refunds", invoice.branchId);
  const owes = invoice.status === "issued" && positive(invoice.settlement?.owedMinor);
  const credit = query.data?.creditBalanceMinor ?? "0";
  const mayPay = at("create") && owes;
  const mayCredit = mayPay && positive(credit);
  if (!mayView && !mayPay) return null;
  const format = (minor: string) =>
    `${formatMinor(minor, invoice.currencyExponent)} ${invoice.currency}`;
  // «تسجيل دفعة» waits for the clinic's switches (applying credit sends no method): off while they load or
  // after a load error. A
  // forbidden read or an answer without the field offers all four, the API's own "no saved switch = on"
  // rule (spec §4.6); the API still refuses a disabled method.
  const forbidden = settings.isError && errorKeyOf(settings.error) === "forbidden";
  const settingsFailed = settings.isError && !forbidden;
  const entryOff = settings.isLoading || settingsFailed;
  const methods = (settings.data?.paymentMethods ?? [])
    .filter((m) => m.enabled)
    .map((m) => m.method);
  const enabled = settings.data?.paymentMethods
    ? methods
    : (["cash", "knet", "bank_transfer", "other"] as const).slice();
  // A late answer closes only the dialog it was sent from, never one opened after it. Only a confirmed
  // success drops the held key; after a failure the balance is refetched and the key kept for a replay,
  // as long as the invoice still shows the same paid amount.
  const done = (opened: NonNullable<typeof open>) => {
    if (opened.kind === "refund") refundKeys.drop(opened.invoice.id, opened.source);
    else keys.drop(opened.kind);
    setOpen((current) => (current === opened ? null : current));
    onChanged();
    refreshPayments();
  };
  const failed = () => {
    onChanged();
    refreshPayments();
  };
  // While a request is in flight the dialog stays open, so its form keeps the Idempotency-Key.
  const hold = (e: Event) => pending && e.preventDefault();
  return (
    <section className="mt-6 flex flex-col gap-3" aria-labelledby="invoice-payment-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="invoice-payment-title" className="text-base font-semibold">
          {t("payments.panel.title")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {mayPay && (
            <Button
              size="sm"
              disabled={entryOff}
              onClick={() => setOpen({ kind: "pay", invoice, credit })}
            >
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
      {mayPay && settingsFailed && (
        <StatusPanel
          icon={AlertCircle}
          title={t("payments.panel.settingsError")}
          body={tDynamic(`errors.${errorKeyOf(settings.error)}`)}
          action={<Button onClick={() => void settings.refetch()}>{t("common.tryAgain")}</Button>}
        />
      )}
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
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t("payments.panel.credit")}: </span>
                <span className="font-medium tabular-nums">
                  {format(query.data.creditBalanceMinor)}
                </span>
                {mayRefund && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={entryOff}
                    onClick={() =>
                      setOpen({
                        kind: "refund",
                        invoice,
                        source: { kind: "credit", capMinor: query.data.creditBalanceMinor },
                      })
                    }
                  >
                    <Undo2 className="size-4" />
                    {t("payments.refund.action")}
                  </Button>
                )}
              </div>
            )}
            <InvoiceMovements
              data={query.data}
              format={format}
              {...(mayRefund && !entryOff
                ? {
                    onRefund: (m) =>
                      setOpen({
                        kind: "refund",
                        invoice,
                        source: {
                          kind: "payment",
                          paymentId: m.paymentId,
                          receiptNumber: m.receiptNumber,
                          capMinor: m.refundableMinor,
                        },
                      }),
                  }
                : {})}
            />
          </>
        ) : (
          <div className="h-16 animate-pulse rounded-md bg-muted" aria-busy="true" />
        ))}
      <Dialog open={open !== null} onOpenChange={(o) => !o && !pending && setOpen(null)}>
        <DialogContent onEscapeKeyDown={hold} onInteractOutside={hold}>
          <DialogHeader>
            <DialogTitle>
              {open?.kind === "refund"
                ? open.source.kind === "payment"
                  ? t("payments.refund.paymentTitle", { number: open.source.receiptNumber })
                  : t("payments.refund.creditTitle")
                : t(
                    open?.kind === "credit"
                      ? "payments.dialog.creditTitle"
                      : "payments.dialog.recordTitle",
                    { number: invoice.number },
                  )}
            </DialogTitle>
          </DialogHeader>
          {open?.kind === "pay" && (
            <RecordPaymentForm
              invoice={open.invoice}
              methods={enabled}
              keyOf={(request) => keys.keyOf("pay", request)}
              onDone={() => done(open)}
              onFailed={failed}
              onPendingChange={setPending}
            />
          )}
          {open?.kind === "credit" && (
            <ApplyCreditForm
              invoice={open.invoice}
              creditMinor={open.credit}
              keyOf={(request) => keys.keyOf("credit", request)}
              onDone={() => done(open)}
              onFailed={failed}
              onPendingChange={setPending}
            />
          )}
          {open?.kind === "refund" && (
            <RefundForm
              invoice={open.invoice}
              source={open.source}
              methods={enabled}
              keyOf={(request) => refundKeys.keyOf(open.invoice.id, open.source, request)}
              onDone={() => done(open)}
              onFailed={failed}
              onPendingChange={setPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
