import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Ban, FileDown, Pencil, Send } from "lucide-react";
import { toast } from "sonner";
import { formatMinor } from "@eyadex/contracts/money";
import type { Invoice } from "@eyadex/contracts/finance";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { formatBp } from "@/shared/money/use-clinic-money";
import { canAtBranch } from "@/shared/permissions/can-at-branch";
import { RequirePermission } from "@/shared/permissions/require-permission";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { InvoiceForm } from "./invoice-form";
import { valuesFromInvoice } from "./invoice-form-draft";
import { useInvoice, useRefreshInvoices } from "./invoice-queries";
import { closePdfTab, openPdfTab, showPdf } from "./invoice-pdf-tab";
import { InvoicePatientName } from "./invoice-patient-name";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { InvoiceTotalsPanel } from "./invoice-totals-panel";
import { InvoiceVoidDialog } from "./invoice-void-dialog";

/**
 * `paymentPanel` is the payments area's slot (ADR-0030): this area never imports it. `onInvoiceChanged`
 * runs after a saved edit or a void, which can release credit, so the route refreshes the payment side.
 */
type Props = {
  invoiceId: string;
  paymentPanel?: (invoice: Invoice, refresh: () => void) => ReactNode;
  onInvoiceChanged?: () => void;
};

export function InvoicePage(props: Props) {
  return (
    <RequirePermission resource="invoices">
      <InvoiceContent {...props} />
    </RequirePermission>
  );
}

function InvoiceContent({ invoiceId, paymentPanel, onInvoiceChanged }: Props) {
  const { t, tDynamic, pick, formatDate } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const { session } = useSession();
  const refresh = useRefreshInvoices();
  const query = useInvoice(invoiceId);
  // The invoice as it was when «تعديل» was pressed: a background refetch must not hand the form a newer
  // version than the lines it shows, or a save would overwrite another user's edit (PR #78 review).
  const [editing, setEditing] = useState<Invoice | null>(null);
  // Likewise the invoice the void dialog was opened on (see InvoiceVoidDialog).
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  // The PDF may be unavailable (503 until the server renderer ships): shown in place, page stays usable.
  const [pdfError, setPdfError] = useState<string | null>(null);
  // One id per press: a retry after a failure reuses it, a confirmed send makes the next press a new one.
  const [sendIds, setSendIds] = useState(() => ({
    email: crypto.randomUUID(),
    whatsapp: crypto.randomUUID(),
  }));
  const onError = (e: unknown) => toast.error(tDynamic(`errors.${errorCodeOf(e)}`));
  const send = useMutation({
    mutationFn: (channel: "email" | "whatsapp") =>
      api.finance.send(persona, invoiceId, { channel, sendRequestId: sendIds[channel] }),
    onSuccess: (_answer, channel) => {
      setSendIds((ids) => ({ ...ids, [channel]: crypto.randomUUID() }));
      toast.success(t("finance.detail.sendRequested"));
    },
    onError,
  });
  const pdf = useMutation({
    mutationFn: (_tab: Window | null) => api.finance.pdf(persona, invoiceId),
    onMutate: () => setPdfError(null),
    onSuccess: (blob, tab) => showPdf(tab, blob, `${invoiceId}.pdf`),
    onError: (e, tab) => {
      closePdfTab(tab);
      setPdfError(tDynamic(`errors.${errorCodeOf(e)}`));
    },
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError || !query.data) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("finance.detail.loadError")}
        body={tDynamic(`errors.${errorCodeOf(query.error)}`)}
      />
    );
  }
  const inv = query.data;
  const format = (minor: string) => `${formatMinor(minor, inv.currencyExponent)} ${inv.currency}`;
  const discountText = (d: NonNullable<Invoice["invoiceDiscount"]>) =>
    d.kind === "pct" ? formatBp(d.bp) : format(d.minor);
  const live = inv.status === "issued";
  // As the API: a branch-scoped write key reaches only the member's branches, while viewing can reach
  // further (a clinic or own view key), so each action is judged at the invoice's own branch.
  const mayAt = (action: "update" | "deactivate" | "create", resource: "invoices" | "discounts") =>
    session ? canAtBranch(session, action, resource, inv.branchId) : false;
  return (
    <div className="max-w-3xl">
      <Link
        to="/clinic/invoices"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("finance.detail.back")}
      </Link>
      <PageHeader
        title={inv.number}
        subtitle={[
          formatDate(inv.issuedAt),
          pick(inv.branchNameAr, inv.branchNameEn),
          t(`finance.detail.source.${inv.source}`),
        ].join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge status={inv.status} />
            <Button
              variant="outline"
              size="sm"
              disabled={pdf.isPending}
              onClick={() => pdf.mutate(openPdfTab())}
            >
              <FileDown className="size-4" />
              {t("finance.detail.pdf")}
            </Button>
            {live && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={send.isPending}>
                    <Send className="size-4" />
                    {t("finance.detail.send")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => send.mutate("email")}>
                    {t("finance.detail.sendEmail")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => send.mutate("whatsapp")}>
                    {t("finance.detail.sendWhatsapp")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {live && mayAt("update", "invoices") && (
              <Button variant="outline" size="sm" onClick={() => setEditing(inv)}>
                <Pencil className="size-4" />
                {t("finance.detail.edit")}
              </Button>
            )}
            {live && mayAt("deactivate", "invoices") && (
              <Button variant="outline" size="sm" onClick={() => setVoiding(inv)}>
                <Ban className="size-4" />
                {t("finance.detail.void")}
              </Button>
            )}
          </div>
        }
      />
      {pdfError && (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium">{t("finance.detail.pdfError")}</span> — {pdfError}
          </span>
        </p>
      )}
      <InvoicePatientName name={inv.patientName} />
      {!live && (
        <div
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
          role="status"
        >
          <div className="flex items-center gap-2 font-semibold">
            <Ban className="size-4" />
            {t("finance.detail.voidBanner")}
          </div>
          {inv.voidedAt && (
            <p className="mt-1 text-muted-foreground">
              {t("finance.detail.voidedOn", {
                date: formatDate(inv.voidedAt),
                reason: inv.voidReason ?? "",
              })}
            </p>
          )}
        </div>
      )}
      <ul className="mb-4 divide-y rounded-md border">
        {inv.lines.map((l) => (
          <li key={l.position} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
            <div>
              <div className="font-medium">{pick(l.descriptionAr, l.descriptionEn)}</div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {l.quantity} × {format(l.unitPriceMinor)}
              </div>
              {l.discount && (
                <div className="text-xs text-muted-foreground">
                  {t("finance.detail.lineDiscount", {
                    value: discountText(l.discount),
                    reason: l.discount.reason,
                  })}
                </div>
              )}
            </div>
            <span className="tabular-nums">{format(l.lineTotalMinor)}</span>
          </li>
        ))}
      </ul>
      {inv.invoiceDiscount && (
        <p className="mb-2 text-sm text-muted-foreground">
          {t("finance.detail.invoiceDiscount", {
            value: discountText(inv.invoiceDiscount),
            reason: inv.invoiceDiscount.reason,
          })}
        </p>
      )}
      <InvoiceTotalsPanel totals={inv} taxRateBp={inv.taxRateBp} format={format} />
      {paymentPanel?.(inv, refresh)}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("finance.invoice.editTitle", { number: inv.number })}</DialogTitle>
          </DialogHeader>
          {editing && (
            <InvoiceForm
              initial={valuesFromInvoice(editing, editing.currencyExponent)}
              source={null}
              editing={editing}
              mayDiscountAt={(branchId) =>
                !!session &&
                branchId !== null &&
                canAtBranch(session, "create", "discounts", branchId)
              }
              priceMissing={false}
              onReload={() => {
                setEditing(null);
                void query.refetch();
              }}
              onDone={() => {
                refresh();
                onInvoiceChanged?.();
                setEditing(null);
                toast.success(t("finance.invoice.saved"));
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <InvoiceVoidDialog
        invoice={voiding}
        onClose={() => setVoiding(null)}
        onVoided={() => {
          refresh();
          onInvoiceChanged?.();
          setVoiding(null);
        }}
      />
    </div>
  );
}
