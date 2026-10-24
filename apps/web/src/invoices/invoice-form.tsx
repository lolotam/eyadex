import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { FilePlus2, ListPlus } from "lucide-react";
import type { Invoice } from "@eyadex/contracts/finance";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useClinicMoney } from "@/shared/money/use-clinic-money";
import { usePersona } from "@/shared/persona/persona-provider";
import { InvoiceDiscountFields } from "./invoice-discount-fields";
import {
  liveTotals,
  toCreateRequest,
  toDiscountInput,
  toLineInputs,
  withoutDiscounts,
  type InvoiceFormValues,
} from "./invoice-form-draft";
import { InvoiceLineRow } from "./invoice-line-row";
import { linePriceMinor, useLinePrices } from "./line-price";
import { useInvoiceOptions } from "./invoice-options";
import { InvoicePatientPicker } from "./invoice-patient-picker";
import { InvoiceTotalsPanel } from "./invoice-totals-panel";
import { releasesOnEdit } from "./invoice-release-warning";
import { ReleaseWarning } from "./release-warning";

type Props = {
  initial: InvoiceFormValues;
  /** Sourced: only source + sourceId go out. Null = manual (patient and branch picked here). */
  source: { source: "appointment" | "visit"; sourceId: string } | null;
  /** Editing this invoice (If-Match: its version); null = issuing a new one. */
  editing: Invoice | null;
  /** `create:discounts` reaching this branch (lesson 1.2); judged again when the branch changes. */
  mayDiscountAt: (branchId: string | null) => boolean;
  priceMissing: boolean;
  onDone: (invoice: Invoice) => void;
  onReload?: () => void;
};

/** Lines, discounts and live totals; issues with an Idempotency-Key or saves with If-Match. */
export function InvoiceForm(p: Props) {
  const { t, tDynamic, pick } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const money = useClinicMoney();
  const options = useInvoiceOptions();
  const [key] = useState(() => crypto.randomUUID());
  const [patientLabel, setPatientLabel] = useState<string | null>(null);
  const form = useForm<InvoiceFormValues>({ defaultValues: p.initial });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const values = form.watch();
  const mayDiscount = p.mayDiscountAt(values.branchId);
  const exponent = money.exponent ?? 0;
  const taxRateBp = p.editing?.taxRateBp ?? money.taxRateBp;
  const totals = liveTotals(values, exponent, taxRateBp);
  const [error, setError] = useState<string | null>(null);
  const prices = useLinePrices();
  /** The price for a service + doctor pick; null when prices are not readable (lines stay manual). */
  const priceFor = (serviceId: string, providerId: string | null) =>
    prices.data ? money.toMajor(linePriceMinor(prices.data, serviceId, providerId) ?? "0") : null;
  // Only a pick on the line refills it, never a load or refetch: saved and typed prices stay.
  const refill = (index: number) => {
    const line = form.getValues(`lines.${index}`);
    if (line?.kind !== "service") return;
    const price = priceFor(line.serviceId, line.providerId);
    if (price !== null) form.setValue(`lines.${index}.unitPrice`, price);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (values.lines.length === 0) throw new ApiError("validation", "finance.invoice.noLines");
      const blankReason = [values.invoiceDiscount, ...values.lines.map((l) => l.discount)].some(
        (d) => d !== null && d.reason.trim() === "",
      );
      if (blankReason) throw new ApiError("discount_reason_required");
      if (p.editing) {
        const parsedLines = toLineInputs(values.lines, exponent);
        const discount = toDiscountInput(values.invoiceDiscount, exponent);
        if (parsedLines === null || discount === "invalid") throw new ApiError("validation");
        return api.finance.edit(persona, p.editing.id, p.editing.version, {
          lines: parsedLines,
          invoiceDiscount: discount,
        });
      }
      const request = toCreateRequest(values, p.source, exponent);
      if (request === null) throw new ApiError("validation");
      return api.finance.issue(persona, request, key);
    },
    onSuccess: (invoice) => p.onDone(invoice),
    onError: (e) =>
      setError(
        e instanceof ApiError && e.message === "finance.invoice.noLines"
          ? t("finance.invoice.noLines")
          : tDynamic(`errors.${errorCodeOf(e)}`),
      ),
  });
  const conflict = save.error instanceof ApiError && save.error.code === "version_conflict";
  const unpricedAt = (i: number) => {
    const line = values.lines[i];
    return (
      !!prices.data &&
      line?.kind === "service" &&
      line.serviceId !== "" &&
      linePriceMinor(prices.data, line.serviceId, line.providerId) === null
    );
  };
  const missingAt = (i: number) =>
    unpricedAt(i) ||
    (p.priceMissing && values.lines[i]?.unitPrice === money.toMajor("0")) ||
    (save.error instanceof ApiError &&
      save.error.code === "price_missing" &&
      save.error.details["position"] === i);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      {p.source === null && !p.editing && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t("finance.invoice.patient")}</Label>
            <InvoicePatientPicker
              value={values.patientId ? { id: values.patientId, label: patientLabel ?? "" } : null}
              onChange={(picked) => {
                form.setValue("patientId", picked?.id ?? null);
                setPatientLabel(picked?.label ?? null);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("finance.invoice.branch")}</Label>
            <Select
              value={values.branchId ?? ""}
              onValueChange={(v) => {
                if (p.mayDiscountAt(v)) form.setValue("branchId", v);
                else form.reset({ ...withoutDiscounts(form.getValues()), branchId: v });
              }}
            >
              <SelectTrigger aria-label={t("finance.invoice.branch")}>
                <SelectValue placeholder={t("finance.invoice.pickBranch")} />
              </SelectTrigger>
              <SelectContent>
                {options.createBranches
                  .filter((b) => b.isActive)
                  .map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {pick(b.nameAr, b.nameEn)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("finance.invoice.lines")}</h3>
        {lines.fields.map((field, index) => {
          const lineTotal =
            totals && totals !== "discount_exceeds_total"
              ? money.format(totals.lines[index]!.lineTotalMinor.toString())
              : null;
          return (
            <InvoiceLineRow
              key={field.id}
              form={form}
              index={index}
              services={options.services}
              providers={options.providers}
              mayDiscount={mayDiscount}
              lineTotal={lineTotal}
              priceMissing={missingAt(index)}
              onPicked={() => refill(index)}
              onRemove={() => lines.remove(index)}
            />
          );
        })}
        {lines.fields.length < 50 && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const serviceId = options.services[0]?.id ?? "";
                lines.append({
                  kind: "service",
                  serviceId,
                  providerId: null,
                  quantity: 1,
                  unitPrice: (serviceId && priceFor(serviceId, null)) || money.toMajor("0"),
                  discount: null,
                });
              }}
            >
              <ListPlus className="size-4" />
              {t("finance.invoice.addService")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                lines.append({
                  kind: "free",
                  descriptionAr: "",
                  descriptionEn: "",
                  quantity: 1,
                  unitPrice: money.toMajor("0"),
                  discount: null,
                })
              }
            >
              <FilePlus2 className="size-4" />
              {t("finance.invoice.addFree")}
            </Button>
          </div>
        )}
      </section>
      {(mayDiscount || values.invoiceDiscount !== null) && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("finance.invoice.invoiceDiscount")}</h3>
          <InvoiceDiscountFields form={form} name="invoiceDiscount" editable={mayDiscount} />
        </section>
      )}
      {totals === "discount_exceeds_total" ? (
        <p className="text-sm text-destructive">{tDynamic("errors.discount_exceeds_total")}</p>
      ) : (
        totals && <InvoiceTotalsPanel totals={totals} taxRateBp={taxRateBp} format={money.format} />
      )}
      {p.editing &&
        totals &&
        totals !== "discount_exceeds_total" &&
        releasesOnEdit(p.editing, totals.totalMinor) && <ReleaseWarning />}
      {error && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
          {error}
          {conflict && p.onReload && (
            <Button type="button" variant="outline" size="sm" onClick={p.onReload}>
              {t("finance.invoice.reload")}
            </Button>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending || money.exponent === null}>
          {t(p.editing ? "finance.invoice.save" : "finance.invoice.issue")}
        </Button>
      </div>
    </form>
  );
}
