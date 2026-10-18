import type { PermissionResource } from "@eyadex/contracts/permissions";
import { can } from "@/shared/permissions/can";

/**
 * The tabs of the clinic Settings page (D-17), in order. Each one shows only to a user who can view
 * its resource; the services and schedules keys vanish with the appointments module, so their tabs do
 * too (UX only: the API refuses as well).
 */
export const SETTINGS_TABS = [
  { id: "general", resource: "clinic_settings", to: "/clinic/settings" },
  // Item 8: a prices-only role reaches the services tab too (prices-only screen).
  { id: "services", resource: "services", to: "/clinic/settings/services", alsoVia: "prices" },
  { id: "schedules", resource: "schedules", to: "/clinic/settings/schedules" },
  // P2-F2: the clinic medicines list; its keys vanish with the medical module.
  { id: "medicines", resource: "medicines", to: "/clinic/settings/medicines" },
  // Phase 3 N1: patient notifications and the clinic's mail senders.
  { id: "notifications", resource: "clinic_settings", to: "/clinic/settings/notifications" },
  { id: "email", resource: "clinic_settings", to: "/clinic/settings/email" },
  // Phase 3 N2: the clinic's WhatsApp channel.
  { id: "whatsapp", resource: "clinic_settings", to: "/clinic/settings/whatsapp" },
  // Finance F1 §2: shown only while the clinic's finance module is on.
  { id: "finance", resource: "clinic_settings", to: "/clinic/settings/finance", module: "finance" },
] as const satisfies readonly {
  id: string;
  resource: PermissionResource;
  to: string;
  module?: "finance";
  alsoVia?: PermissionResource;
}[];

export type SettingsTab = (typeof SETTINGS_TABS)[number];
export type SettingsTabId = SettingsTab["id"];

type Features = Partial<Record<"finance", boolean>>;

/** The tabs a user can view; a module tab needs its module on (absent features hide it). */
export function visibleSettingsTabs(
  permissions: readonly string[],
  features: Features = {},
): SettingsTab[] {
  return SETTINGS_TABS.filter(
    (tab) =>
      (can(permissions, "view", tab.resource) ||
        ("alsoVia" in tab && can(permissions, "view", tab.alsoVia))) &&
      (!("module" in tab) || features[tab.module] === true),
  );
}

/** Where the Settings menu entry lands: the first tab the user can see, or none. */
export function firstSettingsTab(
  permissions: readonly string[],
  features: Features = {},
): SettingsTab | null {
  return visibleSettingsTabs(permissions, features)[0] ?? null;
}
