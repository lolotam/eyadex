import { useMutation } from "@tanstack/react-query";
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
import { useIdempotencyKey, usePendingReport } from "./idempotency-key";
import { checkAmount, smallerMinor } from "./payment-amount";

type Props = {
  invoice: Invoice;
  creditMinor: string;
  onDone: () => void;
  onPendingChange?: (pending: boolean) => void;
};

/** Spends the patient's credit on this invoice, mounted once per open; prefilled with the smaller amount. */
export function ApplyCreditForm({ invoice, creditMinor, onDone, onPendingChange }: Props) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const keyOf = useIdempotencyKey();
  const owed = invoice.settlement?.owedMinor ?? "0";
  const exponent = invoice.currencyExponent;
  const form = useForm<{ amount: string }>({
    defaultValues: { amount: formatMinor(smallerMinor(owed, creditMinor), exponent) },
  });
  const save = useMutation({
    mutationFn: (body: { amountMinor: string }) =>
      api.payments.applyCredit(persona, invoice.id, body, keyOf(body)),
    onSuccess: () => {
      toast.success(t("payments.dialog.applied"));
      onDone();
    },
    onError: (e) => form.setError("root", { message: tDynamic(`errors.${errorKeyOf(e)}`) }),
  });
  usePendingReport(save.isPending, onPendingChange);
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
