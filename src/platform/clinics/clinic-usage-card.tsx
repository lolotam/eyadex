import type { ClinicDetail } from "@contracts/clinics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/shared/i18n/i18n-provider";

function UsageRow({ label, used, max }: { label: string; used: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {used} / {max}
        </span>
      </div>
      <Progress value={percent} />
    </div>
  );
}

export function ClinicUsageCard({ clinic }: { clinic: ClinicDetail }) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("clinics.subscription.usage")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <UsageRow
          label={t("clinics.subscription.usersUsage")}
          used={clinic.usersCount}
          max={clinic.maxUsers}
        />
        <UsageRow
          label={t("clinics.subscription.branchesUsage")}
          used={clinic.branchesCount}
          max={clinic.maxBranches}
        />
      </CardContent>
    </Card>
  );
}
