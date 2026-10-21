import { can } from "@/shared/permissions/can";

export type FinanceTabId = "invoices" | "payments";

const TABS = [
  { id: "invoices", to: "/clinic/invoices", resource: "invoices" },
  { id: "payments", to: "/clinic/payments", resource: "payments" },
] as const;

/** The tabs a user may open, by view permission, never by role. */
export function visibleFinanceTabs(permissions: readonly string[]) {
  return TABS.filter((tab) => can(permissions, "view", tab.resource));
}
