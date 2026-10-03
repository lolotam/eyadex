import { AlertTriangle, CircleCheck, CircleSlash, FlaskConical, Hourglass } from "lucide-react";
import { effectiveClinicStatusSchema } from "@contracts/platform";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { usePlatformOverview } from "./platform-queries";
import { ExpiringClinicsTable } from "./expiring-clinics-table";

const ICONS = {
  trial: FlaskConical,
  active: CircleCheck,
  suspended: CircleSlash,
  expired: Hourglass,
} as const;

export function PlatformOverviewPage() {
  const { t } = useI18n();
  const query = usePlatformOverview();
  return (
    <div>
      <PageHeader title={t("overview.title")} subtitle={t("overview.subtitle")} />
      {query.isLoading ? (
        <LoadingBlock />
      ) : !query.data ? (
        <StatusPanel icon={AlertTriangle} title={t("overview.loadError")} body="" />
      ) : (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {effectiveClinicStatusSchema.options.map((status) => {
              const Icon = ICONS[status];
              return (
                <Card key={status}>
                  <CardContent className="flex flex-col gap-2 p-4">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Icon className="size-4" aria-hidden />
                      {t(`overview.status.${status}`)}
                    </span>
                    <span className="text-2xl font-semibold tabular-nums">
                      {query.data.counts[status] ?? 0}
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <section>
            <h2 className="mb-3 text-base font-semibold">
              {t("overview.expiringTitle", { days: query.data.alertDaysBeforeExpiry })}
            </h2>
            <ExpiringClinicsTable rows={query.data.expiringSoon} />
          </section>
          <p className="text-xs text-muted-foreground">{t("overview.privacyNote")}</p>
        </div>
      )}
    </div>
  );
}
