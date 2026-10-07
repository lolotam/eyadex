import type { ApiMode } from "@/shared/api/api-mode";

export type ClinicTab = "details" | "subscription" | "modules" | "users" | "branches";

/**
 * Against the API the platform clinic read has no language, time zone or members, and the details
 * write does not exist yet, so those two tabs show "coming soon" instead of invented values.
 */
export function isClinicTabServed(tab: ClinicTab, mode: ApiMode): boolean {
  return mode === "mock" || (tab !== "details" && tab !== "users");
}
