import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { AccountForm } from "./account-form";
import { useAccountProfile } from "./settings-queries";

export function AccountPage() {
  const { t } = useI18n();
  const query = useAccountProfile();
  return (
    <div>
      <PageHeader title={t("account.title")} subtitle={t("account.subtitle")} />
      {query.isLoading ? (
        <LoadingBlock />
      ) : query.data ? (
        <AccountForm profile={query.data} />
      ) : (
        <StatusPanel icon={AlertTriangle} title={t("account.loadError")} body="" />
      )}
    </div>
  );
}
