import { can as canFn } from "@/shared/permissions/can";

/** Services access is independent of finance; prices-only access needs the module enabled. */
export function servicesScreenOf(
  permissions: readonly string[],
  can: typeof canFn = canFn,
  finance = false,
): "full" | "prices" | "none" {
  if (can(permissions, "view", "services")) return "full";
  if (finance && can(permissions, "view", "prices")) return "prices";
  return "none";
}
