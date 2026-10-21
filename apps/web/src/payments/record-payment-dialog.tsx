import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { Invoice, PaymentMethod } from "@eyadex/contracts/finance";
import { formatMinor } from "@eyadex/contracts/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorKeyOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { useIdempotencyKey } from "./idempotency-key";
import { checkAmount } from "./payment-amount";

type Values = { method: PaymentMethod; amount: string; reference: string };
type Props = { invoice: Invoice; methods: PaymentMethod[]; onDone: () => void };

/**
 * The record-payment form, mounted once per open: the enabled methods only, the amount prefilled with the
 * balance due, an optional reference. Refused before sending above the balance (F2-Q1).
 */
export function RecordPaymentForm({ invoice, methods, onDone }: Props) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const keyOf = useIdempotencyKey();
  const owed = invoice.settlement?.owedMinor ?? "0";
  const form = useForm<Values>({
    defaultValues: {
      method: methods[0] ?? "cash",
      amount: formatMinor(owed, invoice.currencyExponent),
      reference: "",
    },
  });
  const save = useMutation({
    mutationFn: (body: { method: PaymentMethod; amountMinor: string; reference?: string }) =>
      api.payments.recordPayment(persona, invoice.id, body, keyOf(body)),
    onSuccess: (answer) => {
      toast.success(t("payments.dialog.recorded", { number: answer.payment.receiptNumber }));
      onDone();
    },
    onError: (e) => form.setError("root", { message: tDynamic(`errors.${errorKeyOf(e)}`) }),
  });
  const submit = form.handleSubmit((v) => {
    const checked = checkAmount(v.amount, invoice.currencyExponent, { owedMinor: owed });
    if (!checked.ok) {
      const key =
        checked.error === "amountInvalid"
          ? "payments.dialog.amountInvalid"
          : `errors.${checked.error}`;
      form.setError("amount", { message: tDynamic(key) });
      return;
    }
    const reference = v.reference.trim();
    save.mutate({
      method: v.method,
      amountMinor: checked.amountMinor,
      ...(reference ? { reference } : {}),
    });
  });
  const errors = form.formState.errors;
  if (methods.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("payments.dialog.noMethods")}</p>;
  }
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)} noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payment-method">{t("payments.dialog.method")}</Label>
        <Select
          value={form.watch("method")}
          onValueChange={(v) => form.setValue("method", v as PaymentMethod)}
        >
          <SelectTrigger id="payment-method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {methods.map((m) => (
              <SelectItem key={m} value={m}>
                {t(`payments.method.${m}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payment-amount">
          {t("payments.dialog.amount", { currency: invoice.currency })}
        </Label>
        <Input
          id="payment-amount"
          dir="ltr"
          inputMode="decimal"
          aria-invalid={Boolean(errors.amount)}
          {...form.register("amount")}
        />
        {errors.amount && (
          <p role="alert" className="text-sm text-destructive">
            {errors.amount.message}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payment-reference">
          {t("payments.dialog.reference")}{" "}
          <span className="text-muted-foreground">({t("payments.dialog.optional")})</span>
        </Label>
        <Input id="payment-reference" dir="ltr" maxLength={60} {...form.register("reference")} />
      </div>
      {errors.root && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}>
          {t("payments.dialog.submit")}
        </Button>
      </div>
    </form>
  );
}
