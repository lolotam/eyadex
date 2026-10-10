import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  addPatient,
  at,
  book,
  bookingBody,
  bookingClinic,
  type BookingClinic,
} from "./appointment-fixtures.ts";
import { code, send } from "./scheduling-fixtures.ts";

// Codex A2 r1: two races around the locks of ADR-0027, replayed with owner sessions holding the locks a
// concurrent writer would hold.
let h: Harness;
let C: BookingClinic;
let patient: string;
const DAY = "2027-05-02"; // a Sunday

const ownerSession = () => {
  const url = process.env["EYADEX_TEST_OWNER_URL"];
  if (url === undefined || url === "") throw new Error("EYADEX_TEST_OWNER_URL is not set");
  return postgres(url, { max: 1, onnotice: () => undefined });
};

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

const providerLock = (memberId: string) => `appointments:${C.clinicId}:${memberId}`;

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await bookingClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  patient = await addPatient(h, C.clinicId, C.branchD);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("a booking waiting on the provider's membership row", () => {
  it("decides on the branches the provider has once the row is free, not on the stale ones", async () => {
    const x = ownerSession();
    const held = gate();
    const release = gate();
    try {
      // A user's branch change holds the membership row and moves the doctor from D to R.
      const move = x.begin(async (tx) => {
        await tx`SELECT id FROM memberships WHERE clinic_id = ${C.clinicId}
                 AND id = ${C.doctor.memberId} FOR UPDATE`;
        await tx`DELETE FROM membership_branches WHERE clinic_id = ${C.clinicId}
                 AND membership_id = ${C.doctor.memberId}`;
        await tx`INSERT INTO membership_branches (clinic_id, id, membership_id, branch_id, created_at)
                 VALUES (${C.clinicId}, ${randomUUID()}, ${C.doctor.memberId}, ${C.branchR}, now())`;
        held.open();
        await release.wait;
      });
      await held.wait;
      const booking = book(h, C.admin.cookie, bookingBody(C, patient, at(DAY, "09:00")));
      await waitingOnLocks(1);
      release.open();
      await move;
      expect(code(await booking)).toBe("provider_not_in_branch");
    } finally {
      await x.end();
    }
  });
});

describe("an appointment moved to another provider while a change waits for the first one", () => {
  it("starts over instead of taking the new provider's lock while holding the row", async () => {
    // The doctor back on branch D (the test above moved it to R).
    await h.owner`DELETE FROM membership_branches WHERE clinic_id = ${C.clinicId}
                  AND membership_id = ${C.doctor.memberId}`;
    await h.owner`INSERT INTO membership_branches (clinic_id, id, membership_id, branch_id, created_at)
                  VALUES (${C.clinicId}, ${randomUUID()}, ${C.doctor.memberId}, ${C.branchD}, now())`;
    const res = await book(h, C.admin.cookie, bookingBody(C, patient, at(DAY, "10:00")));
    const id = res.json().appointment.id as string;
    const a = ownerSession();
    const b = ownerSession();
    const aHeld = gate();
    const aRelease = gate();
    const bHeld = gate();
    const bNext = gate();
    try {
      // A writer holds the doctor's lock; meanwhile the row is moved to the admin (committed).
      const holdDoctor = a.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${providerLock(C.doctor.memberId)}, 0))`;
        aHeld.open();
        await aRelease.wait;
      });
      await aHeld.wait;
      const reschedule = send(h, C.admin.cookie, "PUT", `/v1/appointments/${id}`, {
        branchId: C.branchD,
        providerMembershipId: C.doctor.memberId,
        startsAt: at(DAY, "11:00"),
        endsAt: at(DAY, "11:20"),
        overbook: false,
      });
      await waitingOnLocks(1);
      await h.owner`UPDATE appointments SET provider_membership_id = ${C.admin.memberId}
                    WHERE clinic_id = ${C.clinicId} AND id = ${id}`;
      // A status change of the moved row: it holds the admin's lock and will ask for the row.
      const statusLike = b.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${providerLock(C.admin.memberId)}, 0))`;
        bHeld.open();
        await bNext.wait;
        await tx`SELECT id FROM appointments WHERE clinic_id = ${C.clinicId} AND id = ${id} FOR UPDATE`;
      });
      await bHeld.wait;
      aRelease.open();
      await holdDoctor;
      // The reschedule now waits on the admin's lock (old order: while holding the row).
      await waitingOnLocks(1);
      bNext.open();
      const [rs, rb] = await Promise.allSettled([reschedule, statusLike]);
      expect(rb.status).toBe("fulfilled");
      expect(rs.status === "fulfilled" ? rs.value.statusCode : rs.reason).toBe(200);
    } finally {
      await a.end();
      await b.end();
    }
  });
});
