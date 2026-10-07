import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  drain,
  newToken,
  owner,
  parkLeftovers,
  seedClinic,
  seedInvitation,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import {
  auditRows,
  branchHarness,
  branchPayload,
  invitationStatus,
  scopeInvitation,
  seedBranch,
  seedBranchEvent,
  type BranchHarness,
} from "./branch-fixtures.ts";

const open: BranchHarness[] = [];
const make = () => {
  const h = branchHarness();
  open.push(h);
  return h;
};

beforeAll(() => parkLeftovers());
afterEach(async () => {
  await Promise.all(open.splice(0).map((h) => h.close()));
});
afterAll(() => parkLeftovers());

const q = (value: string) => `'${value}'`;

/** The audit row the API writes when an admin reactivates a branch. */
function auditReactivation(clinicId: string, branchId: string, at: Date): void {
  owner(`INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category, entity_type,
           entity_id, branch_id, details, created_at)
         VALUES (${q(clinicId)}, ${q(randomUUID())}, ${q(randomUUID())}, 'branch.reactivated',
           'administrative', 'branch', ${q(branchId)}, NULL, '{}'::jsonb, ${q(at.toISOString())})`);
}

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

describe("auto-cancel attribution (ADR-0013 §12)", () => {
  it("a deactivation superseded by a reactivation cancels nothing; the later one cancels as its admin", async () => {
    const h = make();
    const clinic = seedClinic();
    const branch = seedBranch(clinic.clinicId, false);
    const invite = seedInvitation(clinic, newToken());
    scopeInvitation(clinic.clinicId, invite.invitationId, [branch]);
    const [first, second] = [randomUUID(), randomUUID()];
    // Admin A deactivated it, someone reactivated it, then admin B deactivated it again: a backlog.
    seedBranchEvent(clinic.clinicId, {
      ...branchPayload(clinic.clinicId, branch, first),
      deactivatedAt: at(30).toISOString(),
    });
    auditReactivation(clinic.clinicId, branch, at(20));
    seedBranchEvent(clinic.clinicId, {
      ...branchPayload(clinic.clinicId, branch, second),
      deactivatedAt: at(10).toISOString(),
    });

    await drain(h.poller);

    expect(invitationStatus(clinic.clinicId, invite.invitationId)).toBe("cancelled");
    const rows = auditRows(clinic.clinicId, invite.invitationId);
    expect(rows.map((r) => r.actor_user_id)).toEqual([second]);
  });

  it("leaves an invitation that was never on the deactivated branch to that branch's own event", async () => {
    const h = make();
    const clinic = seedClinic();
    const theirs = seedBranch(clinic.clinicId, false);
    const other = seedBranch(clinic.clinicId, false);
    const invite = seedInvitation(clinic, newToken());
    scopeInvitation(clinic.clinicId, invite.invitationId, [theirs]);
    seedBranchEvent(clinic.clinicId, branchPayload(clinic.clinicId, other));
    await drain(h.poller);
    expect(invitationStatus(clinic.clinicId, invite.invitationId)).toBe("pending");
    expect(auditRows(clinic.clinicId, invite.invitationId)).toHaveLength(0);
  });
});
