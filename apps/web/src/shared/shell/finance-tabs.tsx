import { Link } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { visibleFinanceTabs, type FinanceTabId } from "./finance-tab-list";

/** The invoices / payments link strip above both lists; hidden when only one tab is open to the user. */
export function FinanceTabs({ active }: { active: FinanceTabId }) {
  const { t } = useI18n();
  const { session } = useSession();
  const tabs = visibleFinanceTabs(session?.permissions ?? []);
  if (tabs.length < 2) return null;
  return (
    <Tabs value={active}>
      <TabsList
        aria-label={t("payments.tabs.label")}
        className="mb-4 flex w-full justify-start overflow-x-auto"
      >
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id} asChild>
            <Link to={tab.to}>{t(`payments.tabs.${tab.id}`)}</Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
