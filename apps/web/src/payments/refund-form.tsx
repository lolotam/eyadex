import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import type { CreateRefundRequest, Invoice, PaymentMethod } from "@eyadex/contracts/finance";
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
import { Textarea } from "@/components/ui/textarea";
import { errorKeyOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { usePendingReport } from "./idempotency-key";
import { checkRefundAmount } from "./payment-amount";

/** What the refund is taken from: one receipt of this invoice, or the patient's credit. */
export type RefundSource =
  | { kind: "payment"; paymentId: string; receiptNumber: string; capMinor: string }
  | { kind: "credit"; capMinor: string };

type Values = { method: PaymentMethod; amount: string; reason: string };
type Props = {
  invoice: Invoice;
  source: RefundSource;
  methods: PaymentMethod[];
  keyOf: (request: unknown) => string;
  onDone: () => void;
  onFailed?: () => void;
  onPendingChange?: (pending: boolean) => void;
};

/**
 * The refund form (F2 card 2 §2), mounted once per open: amount capped by its source, any enabled method
 * (F2-Q5), a required reason. A receipt refund warns that the invoice owes the amount again.
 */
export function RefundForm(props: Props) {
  const { invoice, source, methods, keyOf, onDone, onFailed, onPendingChange } = props;
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const exponent = invoice.currencyExponent;
  const form = useForm<Values>({
    defaultValues: {
      method: methods[0] ?? "cash",
      amount: formatMinor(source.capMinor, exponent),
      reason: "",
    },
  });
  const save = useMutation({
    mutationFn: (body: CreateRefundRequest) =>
      api.payments.refund(persona, invoice.id, body, keyOf(body)),
    onSuccess: (answer) => {
      toast.success(t("payments.refund.done"), { description: answer.refund.refundNumber });
      onDone();
    },
    onError: (e) => {
      form.setError("root", { message: tDynamic(`errors.${errorKeyOf(e)}`) });
      onFailed?.();
    },
  });
  usePendingReport(save.isPending, onPendingChange);
  const submit = form.handleSubmit((v) => {
    const checked = checkRefundAmount(v.amount, exponent, source.kind, source.capMinor);
    if (!checked.ok) {
      const key =
        checked.error === "amountInvalid"
          ? "payments.dialog.amountInvalid"
          : `errors.${checked.error}`;
      form.setError("amount", { message: tDynamic(key) });
      return;
    }
    const reason = v.reason.trim();
    if (reason.length === 0) {
      form.setError("reason", { message: t("validation.required") });
      return;
    }
    const base = { amountMinor: checked.amountMinor, method: v.method, reason };
    save.mutate(
      source.kind === "payment"
        ? { source: "payment", paymentId: source.paymentId, ...base }
        : { source: "credit", ...base },
    );
  });
  const errors = form.formState.errors;
  if (methods.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("payments.dialog.noMethods")}</p>;
  }
  const available = `${formatMinor(source.capMinor, exponent)} ${invoice.currency}`;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)} noValidate>
      {source.kind === "payment" && (
        <p role="note" className="flex items-start gap-2 rounded-md border bg-muted p-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {t("payments.refund.owesAgain")}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {t("payments.refund.available", { amount: available })}
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="refund-amount">
          {t("payments.dialog.amount", { currency: invoice.currency })}
        </Label>
        <Input
          id="refund-amount"
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
        <Label htmlFor="refund-method">{t("payments.refund.method")}</Label>
        <Select
          value={form.watch("method")}
          onValueChange={(v) => form.setValue("method", v as PaymentMethod)}
        >
          <SelectTrigger id="refund-method">
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
        {form.watch("method") === "cash" && (
          <p className="text-xs text-muted-foreground">{t("payments.refund.cashHint")}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="refund-reason">{t("payments.refund.reason")}</Label>
        <Textarea
          id="refund-reason"
          maxLength={300}
          rows={2}
          aria-invalid={Boolean(errors.reason)}
          {...form.register("reason")}
        />
        {errors.reason && (
          <p role="alert" className="text-sm text-destructive">
            {errors.reason.message}
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
          {t("payments.refund.submit")}
        </Button>
      </div>
    </form>
  );
}
