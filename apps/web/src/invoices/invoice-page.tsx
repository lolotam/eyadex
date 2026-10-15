import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Ban, FileDown, Pencil, Send } from "lucide-react";
import { toast } from "sonner";
import { formatMinor } from "@eyadex/contracts/money";
import type { Invoice } from "@eyadex/contracts/finance";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { formatBp } from "@/shared/money/use-clinic-money";
import { can } from "@/shared/permissions/can";
import { RequirePermission } from "@/shared/permissions/require-permission";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { InvoiceForm } from "./invoice-form";
import { valuesFromInvoice } from "./invoice-form-draft";
import { useInvoice, useRefreshInvoices } from "./invoice-queries";
import { InvoicePatientName } from "./invoice-patient-name";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { InvoiceTotalsPanel } from "./invoice-totals-panel";

export function InvoicePage({ invoiceId }: { invoiceId: string }) {
  return (
    <RequirePermission resource="invoices">
      <InvoiceContent invoiceId={invoiceId} />
    </RequirePermission>
  );
}

function InvoiceContent({ invoiceId }: { invoiceId: string }) {
  const { t, tDynamic, pick, formatDate } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const { session } = useSession();
  const refresh = useRefreshInvoices();
  const query = useInvoice(invoiceId);
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  // The PDF may be unavailable (503 until the server renderer ships): shown in place, page stays usable.
  const [pdfError, setPdfError] = useState<string | null>(null);
  // One id per press; a retry of the same press (same channel) reuses it.
  const [sendIds] = useState(() => ({ email: crypto.randomUUID(), whatsapp: crypto.randomUUID() }));
  const keys = session?.permissions ?? [];
  const onError = (e: unknown) => toast.error(tDynamic(`errors.${errorCodeOf(e)}`));
  const voidIt = useMutation({
    mutationFn: (inv: Invoice) =>
      api.finance.voidInvoice(persona, inv.id, inv.version, reason.trim()),
    onSuccess: () => {
      refresh();
      setVoiding(false);
      toast.success(t("finance.detail.voided"));
    },
    onError,
  });
  const send = useMutation({
    mutationFn: (channel: "email" | "whatsapp") =>
      api.finance.send(persona, invoiceId, { channel, sendRequestId: sendIds[channel] }),
    onSuccess: () => toast.success(t("finance.detail.sendRequested")),
    onError,
  });
  const pdf = useMutation({
    mutationFn: () => api.finance.pdf(persona, invoiceId),
    onMutate: () => setPdfError(null),
    onSuccess: (blob) => window.open(URL.createObjectURL(blob), "_blank", "noopener"),
    onError: (e) => setPdfError(tDynamic(`errors.${errorCodeOf(e)}`)),
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
        subtitle={[formatDate(inv.issuedAt), t(`finance.detail.source.${inv.source}`)].join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge status={inv.status} />
            <Button
              variant="outline"
              size="sm"
              disabled={pdf.isPending}
              onClick={() => pdf.mutate()}
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
            {live && can(keys, "update", "invoices") && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
                {t("finance.detail.edit")}
              </Button>
            )}
            {live && can(keys, "deactivate", "invoices") && (
              <Button variant="outline" size="sm" onClick={() => setVoiding(true)}>
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
      <InvoicePatientName patientId={inv.patientId} />
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
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("finance.invoice.editTitle", { number: inv.number })}</DialogTitle>
          </DialogHeader>
          {editing && (
            <InvoiceForm
              initial={valuesFromInvoice(inv, inv.currencyExponent)}
              source={null}
              editing={inv}
              mayDiscount={can(keys, "create", "discounts")}
              priceMissing={false}
              onReload={() => {
                setEditing(false);
                void query.refetch();
              }}
              onDone={() => {
                refresh();
                setEditing(false);
                toast.success(t("finance.invoice.saved"));
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={voiding} onOpenChange={setVoiding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("finance.detail.voidTitle", { number: inv.number })}</DialogTitle>
            <DialogDescription>{t("finance.detail.voidBody")}</DialogDescription>
          </DialogHeader>
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
              onClick={() => voidIt.mutate(inv)}
            >
              {t("finance.detail.void")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
