import { RequirePermission } from "@/shared/permissions/require-permission";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { WalkInContent } from "./walk-in-content";

/** `/clinic/visits` (P2-2): opens with `create:visits:own`, the only key it acts on. */
export function VisitsPage() {
  const { t } = useI18n();
  return (
    <RequirePermission action="create" resource="visits" scopes={["own"]}>
      <PageHeader title={t("visits.title")} subtitle={t("visits.subtitle")} />
      <WalkInContent />
    </RequirePermission>
  );
}
