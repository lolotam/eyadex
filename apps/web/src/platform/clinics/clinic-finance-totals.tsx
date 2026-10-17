import { useQuery } from "@tanstack/react-query";
import { formatMinor, SUPPORTED_CURRENCIES } from "@eyadex/contracts/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";

/** The clinic's invoiced total per month (FIN-3), read-only; never an invoice row. */
export function ClinicFinanceTotals({ clinicId }: { clinicId: string }) {
  const { t } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const query = useQuery({
    queryKey: ["platform", "clinics", clinicId, "finance-totals"],
    queryFn: () => api.finance.platformTotals(persona, clinicId),
  });
  const months = query.data?.months ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("finance.platform.totals")}</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingBlock />
        ) : query.isError ? (
          // A failed read is not "no invoices": say so and offer the retry (PR #78 review).
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-destructive">{t("finance.platform.totalsError")}</span>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : months.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("finance.platform.noTotals")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 text-start font-medium">{t("finance.platform.month")}</th>
                <th className="py-2 text-end font-medium">{t("finance.platform.invoiced")}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={`${m.month}-${m.currency}`} className="border-b last:border-0">
                  <td className="py-2 tabular-nums" dir="ltr">
                    {m.month}
                  </td>
                  <td className="py-2 text-end tabular-nums" dir="ltr">
                    {formatMinor(m.invoicedMinor, SUPPORTED_CURRENCIES[m.currency])} {m.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
