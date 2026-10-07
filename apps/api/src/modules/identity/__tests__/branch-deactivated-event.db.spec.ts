import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DATABASE } from "../../../shared/database.provider.ts";
import { BranchChanges } from "../../tenancy/use-cases/branch-changes/branch-changes.ts";
import { closeHarness, openHarness, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { PgExclusiveMembers } from "../persistence/pg-exclusive-members.ts";
import { clinicWithMembers, settledOrBlocked } from "./access-fixtures.ts";
import { branchAction, code, createBranch, setMaxBranches } from "./branch-fixtures.ts";

// Slice 7b-2: every successful deactivation publishes clinic.branch_deactivated (ADR-0013 §12).
let h: Harness;

beforeAll(async () => {
  h = await openHarness({}, true);
});

afterAll(async () => {
  await closeHarness(h);
});

const events = (clinicId: string, branchId: string) =>
  h.owner`SELECT clinic_id, payload FROM outbox_events
          WHERE event_type = 'clinic.branch_deactivated' AND clinic_id = ${clinicId}
            AND payload->>'branchId' = ${branchId}`;

async function clinicWithExtraBranch() {
  const members = await clinicWithMembers(h);
  await setMaxBranches(h, members.admin.clinicId, 10);
  const created = await createBranch(h, members.admin.cookie);
  if (created.statusCode !== 201) throw new Error("create");
  return { ...members, extra: (created.json() as { id: string }).id };
}

describe("clinic.branch_deactivated", () => {
  it("a deactivation writes exactly one event with the four fields; a repeat writes none", async () => {
    const { admin, extra } = await clinicWithExtraBranch();
    expect((await branchAction(h, admin.cookie, extra, "deactivate")).statusCode).toBe(200);
    expect((await branchAction(h, admin.cookie, extra, "deactivate")).statusCode).toBe(200);
    const rows = await events(admin.clinicId, extra);
    expect(rows).toHaveLength(1);
    const payload = rows[0]!["payload"] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "actorUserId",
      "branchId",
      "clinicId",
      "deactivatedAt",
    ]);
    expect(payload).toMatchObject({
      clinicId: admin.clinicId,
      branchId: extra,
      actorUserId: admin.userId,
    });
    expect(new Date(payload["deactivatedAt"] as string).toString()).not.toBe("Invalid Date");
  });

  it("a refused last_active_branch writes no event", async () => {
    const { admin, doctor, extra } = await clinicWithExtraBranch();
    expect((await branchAction(h, admin.cookie, extra, "deactivate")).statusCode).toBe(200);
    const refused = await branchAction(h, admin.cookie, doctor.branchId, "deactivate");
    expect(code(refused)).toBe("last_active_branch");
    expect(await events(admin.clinicId, doctor.branchId)).toHaveLength(0);
  });

  it("a refused branch_has_exclusive_members (no confirmation) writes no event", async () => {
    const { admin, doctor } = await clinicWithExtraBranch();
    const refused = await branchAction(h, admin.cookie, doctor.branchId, "deactivate");
    expect(code(refused)).toBe("branch_has_exclusive_members");
    expect(await events(admin.clinicId, doctor.branchId)).toHaveLength(0);
  });

  it("stamps deactivatedAt after the branches lock, so a reactivation it waited on is never later", async () => {
    const { admin, extra } = await clinicWithExtraBranch();
    let time = new Date(Date.now() - 60_000);
    const clock = { now: () => new Date(time) };
    const changes = new BranchChanges({
      db: h.app.get<Database>(DATABASE),
      clock,
      ids: systemUuidV7(),
      exclusive: new PgExclusiveMembers(),
    });
    const later = new Date(time.getTime() + 30_000);
    let pending: Promise<unknown> | undefined;
    // A reactivation holds the branches lock and audits at `later` while the deactivation waits.
    await h.owner.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`branches:${admin.clinicId}`}, 0))`;
      pending = changes.deactivate({ clinicId: admin.clinicId, userId: admin.userId }, extra);
      await settledOrBlocked(h, pending);
      time = later;
    });
    await pending;
    const [row] = await events(admin.clinicId, extra);
    const payload = row!["payload"] as Record<string, unknown>;
    expect(payload["deactivatedAt"]).toBe(later.toISOString());
  });
});
