import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { visibleSettingsTabs, type SettingsTabId } from "./settings-tabs";

/**
 * The clinic Settings page (D-17): its header, then one tab per part the user can view (General,
 * Services, Work schedules). Each tab is its own route, so a tab is a link and survives a reload.
 */
export function ClinicSettingsShell({
  active,
  children,
}: {
  active: SettingsTabId;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const { session } = useSession();
  const tabs = visibleSettingsTabs(session?.permissions ?? []);
  return (
    <div>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <Tabs value={active}>
        <TabsList
          aria-label={t("settings.title")}
          className="mb-6 flex w-full justify-start overflow-x-auto"
        >
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} asChild>
              <Link to={tab.to}>{t(`settings.tabs.${tab.id}`)}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {children}
    </div>
  );
}
