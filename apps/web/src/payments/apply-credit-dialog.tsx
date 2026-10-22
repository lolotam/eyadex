import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { Invoice } from "@eyadex/contracts/finance";
import { formatMinor } from "@eyadex/contracts/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorKeyOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { usePendingReport } from "./idempotency-key";
import { checkAmount, smallerMinor } from "./payment-amount";

type Props = {
  invoice: Invoice;
  creditMinor: string;
  /** The panel's held Idempotency-Key for this operation (see useHeldKeys). */
  keyOf: (request: unknown) => string;
  /** The invoice's paid amount went up under the held key: a payment may be recorded (useHeldKeys). */
  paidChanged?: boolean;
  onDone: () => void;
  onFailed?: () => void;
  onPendingChange?: (pending: boolean) => void;
};

/** Spends the patient's credit on this invoice, mounted once per open; prefilled with the smaller amount. */
export function ApplyCreditForm(props: Props) {
  const { invoice, creditMinor, keyOf, paidChanged, onDone, onFailed, onPendingChange } = props;
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const owed = invoice.settlement?.owedMinor ?? "0";
  const exponent = invoice.currencyExponent;
  // The credit never covers more than what it holds, so the prefill is the smaller of what the
  // invoice owes and what the patient's credit holds.
  const prefill = formatMinor(smallerMinor(owed, creditMinor), exponent);
  const form = useForm<{ amount: string }>({
    defaultValues: { amount: prefill },
  });
  const save = useMutation({
    mutationFn: (body: { amountMinor: string }) =>
      api.payments.applyCredit(persona, invoice.id, body, keyOf(body)),
    onSuccess: () => {
      toast.success(t("payments.dialog.applied"));
      onDone();
    },
    onError: (e) => {
      form.setError("root", { message: tDynamic(`errors.${errorKeyOf(e)}`) });
      onFailed?.();
    },
  });
  usePendingReport(save.isPending, onPendingChange);
  // The invoice can move while the dialog is open (a refetch after an unclear failure): the amount
  // follows the new owed amount, so the form never offers what the invoice no longer owes.
  useEffect(() => {
    form.resetField("amount", { defaultValue: prefill });
  }, [form, prefill]);
  const submit = form.handleSubmit((v) => {
    const checked = checkAmount(v.amount, exponent, { owedMinor: owed, creditMinor });
    if (!checked.ok) {
      const key =
        checked.error === "amountInvalid"
          ? "payments.dialog.amountInvalid"
          : `errors.${checked.error}`;
      form.setError("amount", { message: tDynamic(key) });
      return;
    }
    save.mutate({ amountMinor: checked.amountMinor });
  });
  const errors = form.formState.errors;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)} noValidate>
      {paidChanged && (
        <p role="alert" className="flex items-start gap-2 rounded-md border bg-muted p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("payments.paidChangedNotice")}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {t("payments.dialog.available", {
          amount: `${formatMinor(creditMinor, exponent)} ${invoice.currency}`,
        })}
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="credit-amount">
          {t("payments.dialog.amount", { currency: invoice.currency })}
        </Label>
        <Input
          id="credit-amount"
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
      {errors.root && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}>
          {t("payments.dialog.apply")}
        </Button>
      </div>
    </form>
  );
}
