import { idSchema } from "@eyadex/contracts/common";

import { ApiError } from "../../../shared/errors.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import type { ClinicRequest } from "../../identity/index.ts";
import type { BillingActor } from "../domain/billing-actor.ts";

/**
 * A malformed id is an unknown record: 404, the same answer as another clinic's id (ISO-02).
 *
 * @returns the id
 */
export const idOf = (raw: string): string => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("not_found");
  return parsed.data;
};

/**
 * The caller as the guard resolved it: keys after the locked modules, and branches.
 *
 * @returns the billing actor
 */
export const actorOf = (request: ClinicRequest): BillingActor => ({
  clinicId: request.clinicContext.clinicId,
  userId: request.clinicContext.userId,
  membershipId: request.clinicContext.membershipId,
  permissions: request.clinicContext.permissions,
  member: request.clinicContext.branchScope,
});
