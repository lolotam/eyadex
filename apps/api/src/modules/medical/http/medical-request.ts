import { idSchema } from "@eyadex/contracts/common";
import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";

import { ApiError } from "../../../shared/errors.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import type { ClinicRequest } from "../../identity/index.ts";
import type { MedicalActor } from "../domain/visit-rules.ts";

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
 * The required `Idempotency-Key` header.
 *
 * @returns the key
 */
export const keyOf = (raw: string | undefined): string => {
  const key = idempotencyKeySchema.safeParse(raw);
  if (!key.success) {
    throw new ApiError("validation", [{ path: ["Idempotency-Key"], code: "required" }]);
  }
  return key.data;
};

/**
 * The caller as the guard resolved it: keys after the locked modules, branches, language.
 *
 * @returns the medical actor
 */
export const actorOf = (request: ClinicRequest): MedicalActor => ({
  clinicId: request.clinicContext.clinicId,
  userId: request.clinicContext.userId,
  membershipId: request.clinicContext.membershipId,
  language: request.clinicMember.preferredLanguage,
  permissions: request.clinicContext.permissions,
  member: request.clinicContext.branchScope,
});
