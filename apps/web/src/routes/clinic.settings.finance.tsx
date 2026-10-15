import { createFileRoute } from "@tanstack/react-router";
import { FinanceSettingsPage } from "@/settings/finance-settings-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/settings/finance")({
  ...pageHead("clinicSettingsFinance"),
  component: FinanceSettingsPage,
});
