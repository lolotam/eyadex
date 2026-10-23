import { Link } from "@tanstack/react-router";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { visibleFinanceTabs, type FinanceTabId } from "./finance-tab-list";

const base = "inline-flex shrink-0 items-center border-b-2 px-3 py-2 text-sm font-medium";
const idle = `${base} border-transparent text-muted-foreground hover:text-foreground`;
const current = `${base} border-primary text-foreground`;

/**
 * The invoices / payments strip above both lists: route navigation, so a nav of links with
 * `aria-current` on the active one, not tabs; hidden when only one is open to the user.
 */
export function FinanceTabs({ active }: { active: FinanceTabId }) {
  const { t } = useI18n();
  const { session } = useSession();
  const tabs = visibleFinanceTabs(session?.permissions ?? []);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={t("payments.tabs.label")} className="mb-4 flex overflow-x-auto border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          to={tab.to}
          className={tab.id === active ? current : idle}
          aria-current={tab.id === active ? "page" : undefined}
        >
          {t(`payments.tabs.${tab.id}`)}
        </Link>
      ))}
    </nav>
  );
}
