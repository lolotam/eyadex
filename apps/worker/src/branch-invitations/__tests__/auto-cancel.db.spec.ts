import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  drain,
  eventRow,
  newToken,
  owner,
  parkLeftovers,
  seedClinic,
  seedInvitation,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import { USER_INVITED } from "../../invitation-mail/domain/invitation-event.ts";
import { RETRY_DELAYS_MS } from "../../invitation-mail/domain/retry-schedule.ts";
import { PgInvitationStateReader } from "../../invitation-mail/persistence/pg-invitation-state-reader.ts";
import {
  auditRows,
  branchHarness,
  branchPayload,
  invitationStatus,
  reserve,
  scopeInvitation,
  seedBranch,
  seedBranchEvent,
  setBranchActive,
  type BranchHarness,
} from "./branch-fixtures.ts";

const open: BranchHarness[] = [];
const make = (options?: Parameters<typeof branchHarness>[0]) => {
  const h = branchHarness(options);
  open.push(h);
  return h;
};

/** A clinic with a deactivated branch D and an active branch K. */
function clinicWithBranches() {
  const clinic = seedClinic();
  const deactivated = seedBranch(clinic.clinicId, false);
  const kept = seedBranch(clinic.clinicId, true);
  return { clinic, deactivated, kept };
}

function invitationOn(
  clinic: ReturnType<typeof seedClinic>,
  branches: string[] | "all",
  options: Parameters<typeof seedInvitation>[2] = {},
) {
  const invite = seedInvitation(clinic, newToken(), options);
  scopeInvitation(clinic.clinicId, invite.invitationId, branches);
  return invite;
}

beforeAll(() => parkLeftovers());
afterEach(async () => {
  await Promise.all(open.splice(0).map((h) => h.close()));
});
afterAll(() => parkLeftovers());

describe("auto-cancel on clinic.branch_deactivated (ADR-0013 §12)", () => {
  it("cancels an invitation left with no active branch, releases its email and audits it", async () => {
    const h = make();
    const { clinic, deactivated } = clinicWithBranches();
    const invite = invitationOn(clinic, [deactivated], { fullName: "Sara 99887766" });
    expect(await reserve(h.app, clinic.clinicId, invite.email, invite.invitationId)).toBe(true);
    // The hold is live: another invitation cannot take the email yet.
    expect(await reserve(h.app, clinic.clinicId, invite.email, randomUUID())).toBe(false);
    const admin = randomUUID();
    const id = seedBranchEvent(clinic.clinicId, branchPayload(clinic.clinicId, deactivated, admin));

    await drain(h.poller);

    expect(invitationStatus(clinic.clinicId, invite.invitationId)).toBe("cancelled");
    expect(eventRow(id).dispatched_at).not.toBeNull();
    expect(await reserve(h.app, clinic.clinicId, invite.email, randomUUID())).toBe(true);
    const rows = auditRows(clinic.clinicId, invite.invitationId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.action).toBe("invitation.auto_cancelled");
    expect(row!.actor_user_id).toBe(admin);
    expect(row!.details).toMatchObject({
      reason: "branch_deactivated",
      branchId: deactivated,
      eventId: id,
      before: { status: "pending", allBranches: false, branchIds: [deactivated] },
      after: { status: "cancelled" },
    });
    const text = JSON.stringify(row!.details);
    expect(text).not.toContain("99887766");
    // The email address is never logged.
    expect(h.lines.join("\n")).not.toContain(invite.email);
    expect(h.lines.join("\n")).toContain('"outcome":"cancelled"');
  });

  it.each([
    ["another active branch", "kept"],
    ["all branches", "all"],
    ["accepted", "accepted"],
    ["already cancelled", "cancelled"],
  ] as const)("leaves an invitation with %s untouched", async (_name, kind) => {
    const h = make();
    const { clinic, deactivated, kept } = clinicWithBranches();
    const status = kind === "accepted" || kind === "cancelled" ? kind : "pending";
    const branches = kind === "kept" ? [deactivated, kept] : kind === "all" ? "all" : [deactivated];
    const invite = invitationOn(clinic, branches, { status });
    seedBranchEvent(clinic.clinicId, branchPayload(clinic.clinicId, deactivated));
    await drain(h.poller);
    expect(invitationStatus(clinic.clinicId, invite.invitationId)).toBe(status);
    expect(auditRows(clinic.clinicId, invite.invitationId)).toHaveLength(0);
  });

  it("cancels nothing when the branch was reactivated before the event is handled", async () => {
    const h = make();
    const { clinic, deactivated } = clinicWithBranches();
    const invite = invitationOn(clinic, [deactivated]);
    seedBranchEvent(clinic.clinicId, branchPayload(clinic.clinicId, deactivated));
    setBranchActive(clinic.clinicId, deactivated, true);
    await drain(h.poller);
    expect(invitationStatus(clinic.clinicId, invite.invitationId)).toBe("pending");
  });

  it("handling the same event twice cancels nothing the second time", async () => {
    const h = make();
    const { clinic, deactivated } = clinicWithBranches();
    const invite = invitationOn(clinic, [deactivated]);
    const request = {
      clinicId: clinic.clinicId,
      branchId: deactivated,
      eventId: randomUUID(),
      actorUserId: randomUUID(),
    };
    expect(await h.canceller.cancelOrphaned(request, h.clock.now)).toBe(1);
    expect(await h.canceller.cancelOrphaned(request, h.clock.now)).toBe(0);
    expect(auditRows(clinic.clinicId, invite.invitationId)).toHaveLength(1);
  });

  it("never touches another clinic's invitation in the identical state (RLS)", async () => {
    const h = make();
    const a = clinicWithBranches();
    const b = clinicWithBranches();
    const theirs = invitationOn(b.clinic, [b.deactivated]);
    seedBranchEvent(a.clinic.clinicId, branchPayload(a.clinic.clinicId, a.deactivated));
    await drain(h.poller);
    expect(invitationStatus(b.clinic.clinicId, theirs.invitationId)).toBe("pending");
    expect(auditRows(b.clinic.clinicId, theirs.invitationId)).toHaveLength(0);
  });

  it.each([
    ["malformed", (c: string, br: string) => ({ ...branchPayload(c, br), actorUserId: "nope" })],
    ["another clinic", (_c: string, br: string) => branchPayload(randomUUID(), br)],
  ])("a %s payload fails at once with invalid_payload", async (_name, build) => {
    const h = make();
    const { clinic, deactivated } = clinicWithBranches();
    const invite = invitationOn(clinic, [deactivated]);
    const id = seedBranchEvent(clinic.clinicId, build(clinic.clinicId, deactivated));
    await drain(h.poller);
    const row = eventRow(id);
    expect([row.failed_at !== null, row.last_error]).toEqual([true, "invalid_payload"]);
    expect(invitationStatus(clinic.clinicId, invite.invitationId)).toBe("pending");
  });

  it("a database error is retried on the schedule, with a short code only", async () => {
    const h = make({
      canceller: {
        cancelOrphaned: () => Promise.reject(new Error("connection lost to db-secret-host")),
      },
    });
    const { clinic, deactivated } = clinicWithBranches();
    const id = seedBranchEvent(clinic.clinicId, branchPayload(clinic.clinicId, deactivated));
    const before = Date.now();
    await h.poller.runOnce();
    const row = eventRow(id);
    expect([row.attempts, row.last_error, row.failed_at]).toEqual([1, "db_error", null]);
    const next = new Date(row.next_attempt_at!).getTime();
    expect(next).toBeGreaterThanOrEqual(before + RETRY_DELAYS_MS[0]! - 1000);
    expect(next).toBeLessThanOrEqual(Date.now() + RETRY_DELAYS_MS[0]! + 1000);
    expect(h.lines.join("\n")).not.toContain("db-secret-host");
  });

  it("routes each type to its own handler and never claims an unhandled type", async () => {
    const seen: string[] = [];
    const h = make({
      extra: {
        [USER_INVITED]: async (event) => {
          seen.push(event.id);
          return { kind: "dispatched" };
        },
      },
    });
    const { clinic, deactivated } = clinicWithBranches();
    const invite = invitationOn(clinic, [deactivated]);
    const mailEvent = seedBranchEvent(clinic.clinicId, { any: 1 }, USER_INVITED);
    const unknown = seedBranchEvent(clinic.clinicId, { any: 1 }, "clinic.something_else");
    seedBranchEvent(clinic.clinicId, branchPayload(clinic.clinicId, deactivated));
    await drain(h.poller);
    expect(seen).toEqual([mailEvent]);
    expect(invitationStatus(clinic.clinicId, invite.invitationId)).toBe("cancelled");
    const untouched = eventRow(unknown);
    expect([untouched.dispatched_at, untouched.failed_at, untouched.attempts]).toEqual([
      null,
      null,
      0,
    ]);
    owner(`UPDATE outbox_events SET failed_at = now() WHERE id = '${unknown}'`);
  });

  it("waits while the mail dispatcher holds the invitation row", async () => {
    const h = make();
    const { clinic, deactivated } = clinicWithBranches();
    const invite = invitationOn(clinic, [deactivated]);
    const reader = new PgInvitationStateReader(h.app);
    let release!: () => void;
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const sending = reader.whileLocked(clinic.clinicId, invite.invitationId, async () => {
      held();
      await new Promise<void>((resolve) => (release = resolve));
    });
    await holding;
    const request = {
      clinicId: clinic.clinicId,
      branchId: deactivated,
      eventId: randomUUID(),
      actorUserId: randomUUID(),
    };
    let done = false;
    const cancelling = h.canceller.cancelOrphaned(request, h.clock.now).then((n) => {
      done = true;
      return n;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(done).toBe(false);
    expect(invitationStatus(clinic.clinicId, invite.invitationId)).toBe("pending");
    release();
    await sending;
    expect(await cancelling).toBe(1);
  });
});
