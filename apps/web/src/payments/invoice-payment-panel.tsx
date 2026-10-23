import { useEffect, useMemo, useRef, useState } from "react";
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
import { useHeldKeys, type HeldContext } from "./idempotency-key";
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
  // The invoice is always the one on screen and the credit is the live one of the payments query: a
  // refetch must not leave the form checking a stale owed amount or a stale credit balance.
  const [open, setOpen] = useState<{ kind: "pay" | "credit"; invoiceId: string } | null>(null);
  const [pending, setPending] = useState(false);
  // The panel stays mounted while the page shows another invoice, so an open form would send what the
  // user typed for the first invoice to the second one: the dialog belongs to the invoice it was
  // opened on, so it closes with it and a form never outlives its invoice.
  const shown = open && open.invoiceId === invoice.id ? open : null;
  const shownInvoiceId = useRef(invoice.id);
  useEffect(() => {
    if (shownInvoiceId.current === invoice.id) return;
    shownInvoiceId.current = invoice.id;
    setOpen(null);
  }, [invoice.id]);
  const at = (action: "view" | "create") =>
    !!session && canAtBranch(session, action, "payments", invoice.branchId);
  const mayView = at("view");
  const query = useInvoicePayments(invoice.id, invoice.version, mayView);
  // The money state of the invoice as the payments query last answered it: the paid amount and the
  // movement count of ONE answer, so the two halves never move apart and a refresh that moves the
  // invoice rotates a held key once and never once per source (PR #111 review). The answer is kept
  // while the query refetches — a version bump starts a new query that holds no data of its own — and
  // it belongs to the invoice it was read on, so it never reaches another one.
  const [answered, setAnswered] = useState<HeldContext | null>(null);
  useEffect(() => {
    if (!query.data) return;
    setAnswered({
      invoiceId: invoice.id,
      paidMinor: query.data.settlement?.paidMinor ?? "0",
      revision: query.data.movements.length,
    });
  }, [query.data, invoice.id]);
  const money = answered !== null && answered.invoiceId === invoice.id ? answered : null;
  // The state the held keys are bound to. A user who may read the payments waits for its first
  // answer: a key minted before it would be "moved" by the real movement count the moment it lands,
  // so the actions stay off until then. A user who may not read them never gets an answer (the API
  // needs `view:payments` for it), so their movements are unknown and stay unknown: their state is the
  // invoice's own settlement alone — one source, which a count that arrives later can never move.
  const invoicePaid = invoice.settlement?.paidMinor ?? "0";
  const keyState = useMemo<HeldContext | null>(() => {
    if (money) return money;
    if (mayView) return null;
    return { invoiceId: invoice.id, paidMinor: invoicePaid, revision: 0 };
  }, [money, mayView, invoice.id, invoicePaid]);
  const keys = useHeldKeys({
    invoiceId: invoice.id,
    paidMinor: keyState?.paidMinor ?? null,
    revision: keyState?.revision ?? 0,
  });
  const owes = invoice.status === "issued" && positive(invoice.settlement?.owedMinor);
  // The payments query holds no data of its own until it answers, and a version bump starts a new one,
  // so the credit would flash "0" in the open dialog: the last balance the query showed is kept for it.
  // It is kept for the invoice it was read on, so another invoice of the same patient never shows
  // a balance that was read for this one.
  const lastCredit = useRef<{ invoiceId: string; minor: string } | null>(null);
  useEffect(() => {
    if (!query.data) return;
    lastCredit.current = { invoiceId: invoice.id, minor: query.data.creditBalanceMinor };
  }, [query.data, invoice.id]);
  const kept = lastCredit.current;
  const credit =
    query.data?.creditBalanceMinor ?? (kept && kept.invoiceId === invoice.id ? kept.minor : "0");
  const mayPay = at("create") && owes;
  const mayCredit = mayPay && positive(credit);
  // The actions wait for the money state: the key they mint is bound to it, so it is minted only
  // against a real answer of the payments query and never against a guess that a later answer would
  // contradict (PR #111 review).
  const ready = keyState !== null;
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
  // success drops the held key; after a failure the payments are refetched and the key kept for a
  // replay, as long as the money state the payments query shows is the one it was minted under.
  const done = (opened: NonNullable<typeof shown>) => {
    keys.drop(opened.kind);
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
              disabled={entryOff || !ready}
              onClick={() => setOpen({ kind: "pay", invoiceId: invoice.id })}
            >
              <Banknote className="size-4" />
              {t("payments.panel.record")}
            </Button>
          )}
          {mayCredit && (
            <Button
              size="sm"
              variant="outline"
              disabled={!ready}
              onClick={() => setOpen({ kind: "credit", invoiceId: invoice.id })}
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
      <Dialog open={shown !== null} onOpenChange={(o) => !o && !pending && setOpen(null)}>
        <DialogContent onEscapeKeyDown={hold} onInteractOutside={hold}>
          <DialogHeader>
            <DialogTitle>
              {t(
                shown?.kind === "credit"
                  ? "payments.dialog.creditTitle"
                  : "payments.dialog.recordTitle",
                {
                  number: invoice.number,
                },
              )}
            </DialogTitle>
          </DialogHeader>
          {shown?.kind === "pay" && (
            <RecordPaymentForm
              invoice={invoice}
              methods={enabled}
              keyOf={(request) => keys.keyOf("pay", request)}
              paidChanged={keys.paidChanged.pay}
              onDone={() => done(shown)}
              onFailed={failed}
              onPendingChange={setPending}
            />
          )}
          {shown?.kind === "credit" && (
            <ApplyCreditForm
              invoice={invoice}
              creditMinor={credit}
              keyOf={(request) => keys.keyOf("credit", request)}
              paidChanged={keys.paidChanged.credit}
              onDone={() => done(shown)}
              onFailed={failed}
              onPendingChange={setPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
