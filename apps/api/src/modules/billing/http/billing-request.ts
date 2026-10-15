import { idSchema } from "@eyadex/contracts/common";
import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";
import type { FastifyReply } from "fastify";

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
 * Sends the invoice's version as its `ETag` (spec §8 rule 10), which `If-Match` later quotes.
 *
 * @returns the invoice, unchanged
 */
export const withETag = <T extends { invoice: { version: number } }>(
  reply: FastifyReply,
  answer: T,
): T => {
  void reply.header("etag", `"${answer.invoice.version}"`);
  return answer;
};

/**
 * The required `If-Match` header (spec §8 rule 10): the version the form saw, as the ETag quoted it.
 * Missing is 428 `precondition_required`; one that names no version can match none, so 412.
 *
 * @returns the version
 */
export const versionOf = (raw: string | undefined): number => {
  if (raw === undefined || raw.trim() === "") throw new ApiError("precondition_required");
  const match = /^(?:W\/)?"?(\d{1,9})"?$/.exec(raw.trim());
  if (match === null) throw new ApiError("version_conflict");
  return Number(match[1]);
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
