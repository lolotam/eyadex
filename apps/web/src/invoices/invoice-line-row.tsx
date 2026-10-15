import { Controller, type UseFormReturn } from "react-hook-form";
import { Trash2 } from "lucide-react";
import type { ClinicService } from "@eyadex/contracts/services";
import type { ProviderSummary } from "@eyadex/contracts/schedules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { InvoiceDiscountFields } from "./invoice-discount-fields";
import type { InvoiceFormValues } from "./invoice-form-draft";

const NO_PROVIDER = "none";

type Props = {
  form: UseFormReturn<InvoiceFormValues>;
  index: number;
  services: ClinicService[];
  providers: ProviderSummary[];
  mayDiscount: boolean;
  /** The line's total, already formatted, or null while it does not parse. */
  lineTotal: string | null;
  priceMissing: boolean;
  onRemove: () => void;
};

/** One invoice line: a clinic service (with its doctor) or a free item in Arabic and English. */
export function InvoiceLineRow(p: Props) {
  const { t, pick, tDynamic } = useI18n();
  const { form, index } = p;
  const kind = form.watch(`lines.${index}.kind`);
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {t(kind === "service" ? "finance.invoice.serviceLine" : "finance.invoice.freeLine")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t("finance.invoice.removeLine")}
          onClick={p.onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {kind === "service" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Controller
            control={form.control}
            name={`lines.${index}.serviceId` as never}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger aria-label={t("finance.invoice.service")}>
                  <SelectValue placeholder={t("finance.invoice.service")} />
                </SelectTrigger>
                <SelectContent>
                  {p.services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {pick(s.nameAr, s.nameEn)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <Controller
            control={form.control}
            name={`lines.${index}.providerId` as never}
            render={({ field }) => (
              <Select
                value={(field.value as string | null) ?? NO_PROVIDER}
                onValueChange={(v) => field.onChange(v === NO_PROVIDER ? null : v)}
              >
                <SelectTrigger aria-label={t("finance.invoice.provider")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROVIDER}>{t("finance.invoice.noProvider")}</SelectItem>
                  {p.providers.map((d) => (
                    <SelectItem key={d.membershipId} value={d.membershipId}>
                      {d.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            {...form.register(`lines.${index}.descriptionAr` as never)}
            dir="rtl"
            maxLength={200}
            aria-label={t("finance.invoice.descriptionAr")}
            placeholder={t("finance.invoice.descriptionAr")}
          />
          <Input
            {...form.register(`lines.${index}.descriptionEn` as never)}
            dir="ltr"
            maxLength={200}
            aria-label={t("finance.invoice.descriptionEn")}
            placeholder={t("finance.invoice.descriptionEn")}
          />
        </div>
      )}
      <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-2">
        <Input
          {...form.register(`lines.${index}.quantity`, { valueAsNumber: true })}
          type="number"
          min={1}
          max={999}
          dir="ltr"
          aria-label={t("finance.invoice.quantity")}
        />
        <Input
          {...form.register(`lines.${index}.unitPrice`)}
          inputMode="decimal"
          dir="ltr"
          aria-label={t("finance.invoice.unitPrice")}
          placeholder={t("finance.invoice.unitPrice")}
        />
        <span
          className="min-w-24 text-end text-sm tabular-nums"
          aria-label={t("finance.invoice.lineTotal")}
        >
          {p.lineTotal ?? "—"}
        </span>
      </div>
      {p.priceMissing && (
        <p className="text-xs font-medium text-destructive">{tDynamic("errors.price_missing")}</p>
      )}
      <InvoiceDiscountFields
        form={form}
        name={`lines.${index}.discount`}
        editable={p.mayDiscount}
      />
    </div>
  );
}
