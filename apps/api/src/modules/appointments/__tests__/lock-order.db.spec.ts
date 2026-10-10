import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { schedulingClinic, send } from "./scheduling-fixtures.ts";

// ADR-0027: the three sessions of the cycle Codex found on A1. (a) a user's branch change holds
// `users:` and the membership row, then asks `branches:`; (b) a branch deactivation holds
// `branches:`, then asks the branch row; (c) the real schedule save of that member in that branch.
// With the old order (c) held the branch row and waited on the membership row: a cycle.
let h: Harness;
let C: Awaited<ReturnType<typeof schedulingClinic>>;

const ownerUrl = (): string => {
  const url = process.env["EYADEX_TEST_OWNER_URL"];
  if (url === undefined || url === "") throw new Error("EYADEX_TEST_OWNER_URL is not set");
  return url;
};

/** Until at least `n` sessions of this database wait on a lock (advisory or row). */
async function waitingOnLocks(n: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_stat_activity
                                WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if ((row!["n"] as number) >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fewer than ${n} sessions wait on a lock`);
}

function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await schedulingClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  const res = await send(
    h,
    C.admin.cookie,
    "PUT",
    `/v1/users/${C.doctor.memberId}/booking-profile`,
    {
      acceptsAppointments: true,
      defaultDurationMinutes: 20,
    },
  );
  if (res.statusCode !== 200) throw new Error(`booking profile: ${res.statusCode}`);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("the global lock order (ADR-0027)", () => {
  it("a schedule save, a user's branch change and a branch deactivation all complete", async () => {
    const a = postgres(ownerUrl(), { max: 1, onnotice: () => undefined });
    const b = postgres(ownerUrl(), { max: 1, onnotice: () => undefined });
    const aHeld = gate();
    const aNext = gate();
    const bHeld = gate();
    const bNext = gate();
    try {
      const sessionA = a.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`users:${C.clinicId}`}, 0))`;
        await tx`SELECT id FROM memberships
                 WHERE clinic_id = ${C.clinicId} AND id = ${C.doctor.memberId} FOR UPDATE`;
        aHeld.open();
        await aNext.wait;
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`branches:${C.clinicId}`}, 0))`;
      });
      await aHeld.wait;
      const sessionB = b.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`branches:${C.clinicId}`}, 0))`;
        bHeld.open();
        await bNext.wait;
        await tx`SELECT id FROM branches WHERE clinic_id = ${C.clinicId} AND id = ${C.branchD}
                 FOR UPDATE`;
      });
      await bHeld.wait;
      const save = send(
        h,
        C.admin.cookie,
        "PUT",
        `/v1/schedules/${C.doctor.memberId}/branches/${C.branchD}`,
        { shifts: [{ weekday: 3, startsAt: "08:00", endsAt: "12:00" }] },
      );
      // (c) waits on the membership row (the old order: while holding the branch row).
      await waitingOnLocks(1);
      aNext.open();
      // (a) waits on `branches:`.
      await waitingOnLocks(2);
      // (b) asks the branch row: with the old order the three now wait on each other.
      bNext.open();
      const [ra, rb, rc] = await Promise.allSettled([sessionA, sessionB, save]);
      expect(ra.status).toBe("fulfilled");
      expect(rb.status).toBe("fulfilled");
      expect(rc.status === "fulfilled" ? rc.value.statusCode : rc.reason).toBe(200);
    } finally {
      await a.end();
      await b.end();
    }
  });
});
