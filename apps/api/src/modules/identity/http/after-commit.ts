import { Logger } from "@nestjs/common";

import type { AuthorizationInvalidator } from "../ports/authorization-invalidator.ts";
import type { MemberSessionRevoker } from "../ports/member-session-revoker.ts";

const logger = new Logger("users");

/**
 * Runs after a committed users/invitations change (ADR-0012): first the sessions of a deactivated member,
 * then the clinic's cache version. A failure is logged, never thrown: the change is already committed, the
 * guard refuses a deactivated membership on every request anyway, and the cache lives at most 30 s.
 */
export async function afterUserCommit(
  clinicId: string,
  invalidator: AuthorizationInvalidator,
  revoker: MemberSessionRevoker,
  revokeUserId: string | null,
): Promise<void> {
  if (revokeUserId !== null) {
    try {
      await revoker.revokeMemberSessions(revokeUserId);
    } catch {
      logger.warn("member session revocation failed; the guard still refuses the membership");
    }
  }
  try {
    await invalidator.clinicChanged(clinicId);
  } catch {
    logger.warn("authorization cache invalidation failed; relying on the 30 s TTL");
  }
}
