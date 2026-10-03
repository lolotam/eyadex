import type { InvitationRecord } from "@eyadex/contracts/invitations";
import type { MockState } from "./mock-store";

/**
 * Mock-only stable hash (two FNV-1a passes). The real backend stores a SHA-256 hash;
 * this stays synchronous so seeding and lookups need no async plumbing.
 */
export function hashInviteToken(token: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ token.length;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `h_${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/**
 * Issues a fresh token: only its hash is kept on the invitation, so any older link stops working.
 * The plain token goes to the mock outbox, which stands in for the invitation email.
 */
export function issueInviteToken(db: MockState, inv: InvitationRecord): string {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  inv.tokenHash = hashInviteToken(token);
  db.inviteOutbox[inv.id] = token;
  return token;
}

export function findInvitationByToken(db: MockState, token: string): InvitationRecord | undefined {
  const hash = hashInviteToken(token);
  return db.invitations.find((i) => i.tokenHash === hash);
}

/** PRD 4.11: invitation audit snapshots carry only these fields — never a token or its hash. */
export function invitationAuditSnapshot(inv: InvitationRecord) {
  return {
    id: inv.id,
    email: inv.email,
    fullName: inv.fullName,
    roleId: inv.roleId,
    allBranches: inv.allBranches,
    branchIds: [...inv.branchIds],
    status: inv.status,
    expiresAt: inv.expiresAt,
  };
}
