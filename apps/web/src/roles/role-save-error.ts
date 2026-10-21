import type { WebErrorCode } from "@eyadex/contracts/common";
import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";
import { uncoveredWrite } from "@eyadex/contracts/roles";
import { ApiError, errorCodeOf } from "@/shared/api/api-error";

export type RoleSaveError = {
  code: WebErrorCode;
  /** The module whose kept keys break the view rule, for the message to name. */
  module?: string;
  details: Readonly<Record<string, string | number>>;
};

/**
 * What a failed role save tells the admin. The form sends the keys it does not show too, so a broken pair
 * of a switched-off module can be refused by the request's own check (`validation`) before the server's
 * check on the saved set (`role_hidden_keys_invalid`) runs; both are reported as the latter, naming the
 * module, because the admin cannot fix that pair until the module is switched on.
 */
export function roleSaveError(
  error: unknown,
  sent: readonly string[],
  shown: ReadonlySet<string>,
): RoleSaveError {
  const code = errorCodeOf(error);
  const details = error instanceof ApiError ? error.details : {};
  const named = details["module"];
  if (typeof named === "string") return { code, module: named, details };
  if (code !== "validation" || uncoveredWrite(sent.filter((k) => shown.has(k)))) {
    return { code, details };
  }
  const gap = uncoveredWrite(sent);
  if (gap === undefined) return { code, details };
  const module = PERMISSION_CATALOG.find((p) => p.key === gap)?.module ?? "core";
  return { code: "role_hidden_keys_invalid", module, details };
}
