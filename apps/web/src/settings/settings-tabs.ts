import type { PermissionResource } from "@eyadex/contracts/permissions";
import { can } from "@/shared/permissions/can";

/**
 * The tabs of the clinic Settings page (D-17), in order. Each one shows only to a user who can view
 * its resource; the services and schedules keys vanish with the appointments module, so their tabs do
 * too (UX only: the API refuses as well).
 */
export const SETTINGS_TABS = [
  { id: "general", resource: "clinic_settings", to: "/clinic/settings" },
  { id: "services", resource: "services", to: "/clinic/settings/services" },
  { id: "schedules", resource: "schedules", to: "/clinic/settings/schedules" },
] as const satisfies readonly { id: string; resource: PermissionResource; to: string }[];

export type SettingsTab = (typeof SETTINGS_TABS)[number];
export type SettingsTabId = SettingsTab["id"];

export function visibleSettingsTabs(permissions: readonly string[]): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => can(permissions, "view", tab.resource));
}

/** Where the Settings menu entry lands: the first tab the user can see, or none. */
export function firstSettingsTab(permissions: readonly string[]): SettingsTab | null {
  return visibleSettingsTabs(permissions)[0] ?? null;
}
