import type { ApiMode } from "@/shared/api/api-mode";

export type ClinicTab = "details" | "subscription" | "modules" | "users" | "branches";

/**
 * Against the API there is no clinic details write and no members read yet, so those two tabs show
 * "coming soon" instead of a form that cannot save or invented rows.
 */
export function isClinicTabServed(tab: ClinicTab, mode: ApiMode): boolean {
  return mode === "mock" || (tab !== "details" && tab !== "users");
}
