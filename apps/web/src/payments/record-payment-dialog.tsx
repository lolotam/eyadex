import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
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
import { usePendingReport } from "./idempotency-key";
import { checkAmount } from "./payment-amount";

type Values = { method: PaymentMethod; amount: string; reference: string };
type Props = {
  invoice: Invoice;
  methods: PaymentMethod[];
  /** The panel's held Idempotency-Key for this operation (see useHeldKeys). */
  keyOf: (request: unknown) => string;
  /** The invoice's paid amount changed under the held key: a payment may be recorded (useHeldKeys). */
  paidChanged?: boolean;
  onDone: () => void;
  onFailed?: () => void;
  onPendingChange?: (pending: boolean) => void;
};

/**
 * The record-payment form, mounted once per open: the enabled methods only, the amount prefilled with the
 * balance due, an optional reference. Refused before sending above the balance (F2-Q1). A payment may
 * already be recorded when the invoice's paid amount changed, so the form warns before sending again.
 */
export function RecordPaymentForm(props: Props) {
  const { invoice, methods, keyOf, paidChanged, onDone, onFailed, onPendingChange } = props;
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const owed = invoice.settlement?.owedMinor ?? "0";
  // What the amount field carries: the balance due, until the user types another amount.
  const prefill = formatMinor(owed, invoice.currencyExponent);
  const form = useForm<Values>({
    defaultValues: {
      method: methods[0] ?? "cash",
      amount: prefill,
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
    onError: (e) => {
      form.setError("root", { message: tDynamic(`errors.${errorKeyOf(e)}`) });
      onFailed?.();
    },
  });
  usePendingReport(save.isPending, onPendingChange);
  // The switches can arrive or change after the form opened: a method no longer on falls back to the
  // first one that is, so the form never sends a method the clinic turned off.
  useEffect(() => {
    const first = methods[0];
    if (first && !methods.includes(form.getValues("method"))) form.setValue("method", first);
  }, [methods, form]);
  // The amount the field was last prefilled with, so a change of the owed amount can tell an untouched
  // field from one the user typed in.
  const prefilled = useRef(prefill);
  // The invoice can move while the dialog is open (a refetch after an unclear failure): an untouched
  // amount follows the new owed amount, so the form never offers what the invoice no longer owes. A
  // typed amount is the user's decision and stays as it is — checkAmount refuses it before sending when
  // it is now above the balance. The method and the reference stay as the user typed them.
  useEffect(() => {
    const state = form.getFieldState("amount");
    const typed = state.isDirty && form.getValues("amount") !== prefilled.current;
    if (typed) return;
    form.resetField("amount", { defaultValue: prefill });
    prefilled.current = prefill;
  }, [form, prefill]);
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
      {paidChanged && (
        <p role="alert" className="flex items-start gap-2 rounded-md border bg-muted p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("payments.paidChangedNotice")}
        </p>
      )}
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
