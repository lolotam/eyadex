import type { ClinicDetail } from "@contracts/clinics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { UsageRow } from "./usage-row";

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
