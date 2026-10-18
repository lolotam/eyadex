import { can as canFn } from "@/shared/permissions/can";

/** Which services screen a user gets: by permission keys, never by role. */
export function servicesScreenOf(
  permissions: readonly string[],
  can: typeof canFn = canFn,
): "full" | "prices" | "none" {
  if (can(permissions, "view", "services")) return "full";
  if (can(permissions, "view", "prices")) return "prices";
  return "none";
}
