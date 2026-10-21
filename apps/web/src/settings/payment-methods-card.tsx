import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  PAYMENT_METHODS,
  type FinanceSettings,
  type PaymentMethod,
} from "@eyadex/contracts/finance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorKeyOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { useRefreshFinanceSettings } from "./finance-queries";

type Switches = Record<PaymentMethod, boolean>;

/** Absent means all four on, as the API reads "no saved switch = on" (spec §4.6). */
export function switchesOf(settings: Pick<FinanceSettings, "paymentMethods">): Switches {
  const saved = new Map((settings.paymentMethods ?? []).map((m) => [m.method, m.enabled]));
  return Object.fromEntries(PAYMENT_METHODS.map((m) => [m, saved.get(m) ?? true])) as Switches;
}

type Props = { settings: FinanceSettings; editable: boolean };

/**
 * «طرق الدفع»: four switches in the fixed order. The form starts from the first load only, so a refetch never
 * resets unsaved switches; the last switch on cannot be turned off (the API refuses too).
 */
export function PaymentMethodsCard({ settings, editable }: Props) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const refresh = useRefreshFinanceSettings();
  const [values, setValues] = useState<Switches>(() => switchesOf(settings));
  const [error, setError] = useState<string | null>(null);
  const onCount = PAYMENT_METHODS.filter((m) => values[m]).length;
  const save = useMutation({
    mutationFn: () =>
      api.finance.setPaymentMethods(
        persona,
        PAYMENT_METHODS.map((method) => ({ method, enabled: values[method] })),
      ),
    onSuccess: () => {
      setError(null);
      refresh();
      toast.success(t("payments.methods.saved"));
    },
    onError: (e) => setError(tDynamic(`errors.${errorKeyOf(e)}`)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("payments.methods.title")}</CardTitle>
        <CardDescription>
          {editable ? t("payments.methods.subtitle") : t("payments.methods.readOnly")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {PAYMENT_METHODS.map((m) => {
            const last = values[m] && onCount === 1;
            return (
              <li key={m} className="flex items-center justify-between gap-3">
                <Label htmlFor={`method-${m}`}>{t(`payments.method.${m}`)}</Label>
                <Switch
                  id={`method-${m}`}
                  checked={values[m]}
                  disabled={!editable || last}
                  title={last ? t("payments.methods.lastOn") : undefined}
                  onCheckedChange={(on) => setValues((v) => ({ ...v, [m]: on }))}
                />
              </li>
            );
          })}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {editable && (
          <div className="flex justify-end">
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
              {t("payments.methods.save")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
