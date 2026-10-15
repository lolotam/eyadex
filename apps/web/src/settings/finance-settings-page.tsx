import { AlertTriangle } from "lucide-react";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useFinanceSettings } from "@/shared/money/use-clinic-money";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { SectionHeader } from "@/shared/shell/section-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { ClinicFinanceCard } from "./clinic-finance-card";
import { ClinicLogoCard } from "./clinic-logo-card";
import { ClinicSettingsGuard } from "./clinic-settings-guard";
import { InvoicePrefixesCard } from "./invoice-prefixes-card";

function FinanceSettingsContent() {
  const { t, tDynamic } = useI18n();
  const { session } = useSession();
  const query = useFinanceSettings();
  const keys = session?.permissions ?? [];
  const editable = can(keys, "update", "clinic_settings");
  if (session && !session.features.finance) {
    return <StatusPanel icon={AlertTriangle} title={t("errors.module_disabled")} body="" />;
  }
  return (
    <div>
      <SectionHeader
        title={t("finance.settings.title")}
        subtitle={t("finance.settings.subtitle")}
      />
      {query.isLoading ? (
        <LoadingBlock />
      ) : query.data ? (
        <div className="grid max-w-3xl gap-4">
          <ClinicFinanceCard settings={query.data} editable={editable} />
          <ClinicLogoCard hasLogo={query.data.hasLogo} editable={editable} />
          {can(keys, "update", "branches") && <InvoicePrefixesCard />}
        </div>
      ) : (
        <StatusPanel
          icon={AlertTriangle}
          title={t("finance.loadError")}
          body={tDynamic(`errors.${errorCodeOf(query.error)}`)}
        />
      )}
    </div>
  );
}

/** `/clinic/settings/finance` (F1 §2): currency and tax, registration number, logo, prefixes. */
export function FinanceSettingsPage() {
  return (
    <ClinicSettingsGuard active="finance">
      <FinanceSettingsContent />
    </ClinicSettingsGuard>
  );
}
