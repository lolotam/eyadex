import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";
import { ApiError } from "../api-error";

/**
 * The API's `keyOf` (medical-request.ts): a missing, blank, over-long or non-printable Idempotency-Key is
 * `validation`, read after the guard and the body.
 */
export function requireIdempotencyKey(key: string): string {
  if (!idempotencyKeySchema.safeParse(key).success) throw new ApiError("validation");
  return key;
}

/**
 * The ledger key of a clinic write's Idempotency-Key. The API claims a key under the operation and
 * the acting user (`branch:create:<userId>`, `patients:create:<userId>`…) inside the clinic, so two
 * users of one clinic never share a key. Each mock ledger holds one operation, so the clinic, the
 * actor and the key are enough. Entries saved before this scope (`clinicId:key`) never match it.
 */
export function actorReplayKey(clinicId: string, actorId: string, key: string): string {
  return `${clinicId}:${actorId}:${key}`;
}
