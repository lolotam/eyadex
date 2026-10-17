import { Controller, type UseFormReturn } from "react-hook-form";
import { Percent, X } from "lucide-react";
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
import type { InvoiceFormValues } from "./invoice-form-draft";

type Name = "invoiceDiscount" | `lines.${number}.discount`;

/** One discount: % or amount, value and a required reason. Shown only with `create:discounts:*`. */
export function InvoiceDiscountFields({
  form,
  name,
  editable,
}: {
  form: UseFormReturn<InvoiceFormValues>;
  name: Name;
  editable: boolean;
}) {
  const { t } = useI18n();
  const value = form.watch(name);
  if (value === null) {
    if (!editable) return null;
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() =>
          form.setValue(name, { kind: "pct", value: "", reason: "" }, { shouldDirty: true })
        }
      >
        <Percent className="size-4" />
        {t("finance.invoice.addDiscount")}
      </Button>
    );
  }
  return (
    <div className="grid gap-2 rounded-md border border-dashed p-2 sm:grid-cols-[8rem_8rem_1fr_auto]">
      <Controller
        control={form.control}
        name={`${name}.kind` as never}
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
            <SelectTrigger aria-label={t("finance.invoice.discount")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pct">{t("finance.invoice.discountPct")}</SelectItem>
              <SelectItem value="amount">{t("finance.invoice.discountAmount")}</SelectItem>
            </SelectContent>
          </Select>
        )}
      />
      <Input
        {...form.register(`${name}.value` as never)}
        inputMode="decimal"
        dir="ltr"
        disabled={!editable}
        aria-label={t("finance.invoice.discountValue")}
        placeholder={t("finance.invoice.discountValue")}
      />
      <Input
        {...form.register(`${name}.reason` as never)}
        maxLength={300}
        disabled={!editable}
        aria-label={t("finance.invoice.discountReason")}
        placeholder={t("finance.invoice.discountReason")}
      />
      {editable && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("finance.prices.remove")}
          onClick={() => form.setValue(name, null, { shouldDirty: true })}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
