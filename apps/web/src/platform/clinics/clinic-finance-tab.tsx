import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { currencyCodeSchema, type CurrencyCode } from "@eyadex/contracts/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useOncePerOpen } from "@/shared/forms/use-once-per-open";
import { usePersona } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { StatusPanel } from "@/shared/shell/status-panel";
import { ClinicFinanceTotals } from "./clinic-finance-totals";

/** F1 §7b: the clinic's currency and tax rate (PATCH), then its monthly totals — never an invoice. */
export function ClinicFinanceTab({ clinicId }: { clinicId: string }) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const queryClient = useQueryClient();
  const key = ["platform", "clinics", clinicId, "finance"];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.finance.platformFinance(persona, clinicId),
  });
  const [currency, setCurrency] = useState<CurrencyCode>("KWD");
  const [taxText, setTaxText] = useState("0");
  const [error, setError] = useState<string | null>(null);
  // Once per clinic (lesson 4.2): a refetch, the one after a save included, never resets input.
  useOncePerOpen(query.data ? clinicId : null, () => {
    if (!query.data) return;
    setCurrency(query.data.currency);
    setTaxText(String(query.data.taxRateBp));
  });
  const taxRateBp = /^\d{1,5}$/.test(taxText) ? Number(taxText) : NaN;
  const validTax = Number.isInteger(taxRateBp) && taxRateBp >= 0 && taxRateBp <= 10000;
  const save = useMutation({
    mutationFn: () =>
      api.finance.updatePlatformFinance(persona, clinicId, {
        ...(currency !== query.data?.currency ? { currency } : {}),
        taxRateBp,
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: key });
      toast.success(t("finance.platform.saved"));
    },
    onError: (e) => setError(tDynamic(`errors.${errorCodeOf(e)}`)),
  });
  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("finance.loadError")}
        body={tDynamic(`errors.${errorCodeOf(query.error)}`)}
      />
    );
  }
  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("finance.platform.title")}</CardTitle>
          <CardDescription>{t("finance.platform.body")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (validTax) save.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label>{t("finance.platform.currency")}</Label>
              <Select
                value={currency}
                onValueChange={(v) => setCurrency(currencyCodeSchema.parse(v))}
              >
                <SelectTrigger aria-label={t("finance.platform.currency")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencyCodeSchema.options.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="platform-tax-bp">{t("finance.platform.taxRate")}</Label>
              <Input
                id="platform-tax-bp"
                value={taxText}
                inputMode="numeric"
                dir="ltr"
                aria-invalid={!validTax}
                onChange={(e) => setTaxText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("finance.platform.taxHint")}</p>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive sm:col-span-2">
                {error}
              </p>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={!validTax || save.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <ClinicFinanceTotals clinicId={clinicId} />
    </div>
  );
}
