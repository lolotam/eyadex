import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { FinanceSettings } from "@eyadex/contracts/finance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { formatBp } from "@/shared/money/use-clinic-money";
import { usePersona } from "@/shared/persona/persona-provider";
import { useRefreshFinanceSettings } from "./finance-queries";

/** Currency and tax (set by the platform, read-only here) and the commercial registration number. */
export function ClinicFinanceCard({
  settings,
  editable,
}: {
  settings: FinanceSettings;
  editable: boolean;
}) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const refresh = useRefreshFinanceSettings();
  const [regNo, setRegNo] = useState(settings.commercialRegNo ?? "");
  const save = useMutation({
    mutationFn: () => api.finance.updateSettings(persona, regNo.trim() || null),
    onSuccess: () => {
      refresh();
      toast.success(t("finance.settings.regNoSaved"));
    },
    onError: (e) => toast.error(tDynamic(`errors.${errorCodeOf(e)}`)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("finance.settings.title")}</CardTitle>
        <CardDescription>{t("finance.settings.setByPlatform")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t("finance.settings.currency")}</dt>
            <dd className="font-medium" dir="ltr">
              {settings.currency}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("finance.settings.taxRate")}</dt>
            <dd className="font-medium tabular-nums">{formatBp(settings.taxRateBp)}</dd>
          </div>
        </dl>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="commercial-reg-no">{t("finance.settings.regNo")}</Label>
            <Input
              id="commercial-reg-no"
              value={regNo}
              maxLength={40}
              disabled={!editable}
              dir="ltr"
              onChange={(e) => setRegNo(e.target.value)}
            />
          </div>
          {editable && (
            <Button type="submit" disabled={save.isPending}>
              {t("common.save")}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
