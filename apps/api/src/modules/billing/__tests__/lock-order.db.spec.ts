import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import { financeClinic, setPrefixes, type FinanceClinic } from "./billing-fixtures.ts";

// ADR-0027 item 6 (spec §8d item 4): the issue locks the lines' membership rows before the patient row
// and the branch row, so a user's branch change, a branch deactivation and an invoice at once cannot
// deadlock: the invoice waits on the membership row without holding the branch row.
let h: Harness;
let C: FinanceClinic;

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

/** The service line of the invoice: the clinic's service with the doctor of the line. */
const serviceLine = (unitPriceMinor: string) => ({
  kind: "service",
  serviceId: C.serviceId,
  providerId: C.doctor.memberId,
  quantity: 1,
  unitPriceMinor,
  discount: null,
});

/**
 * The three sessions of the cycle: (a) a user's branch change holds `users:` and the membership row,
 * then asks `branches:`; (b) a branch deactivation holds `branches:`, then asks the branch row; (c) is
 * the caller's own request, which must wait on the membership row without holding the branch row.
 *
 * @param third the request of (c), started once (a) and (b) hold their locks
 * @returns the three settled results
 */
async function replay<T>(
  third: () => Promise<T>,
): Promise<
  [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>, PromiseSettledResult<T>]
> {
  const a = postgres(ownerUrl(), { max: 1, onnotice: () => undefined });
  const b = postgres(ownerUrl(), { max: 1, onnotice: () => undefined });
  const aHeld = gate();
  const aNext = gate();
  const bHeld = gate();
  const bNext = gate();
  let sessionA: Promise<unknown> | undefined;
  let sessionB: Promise<unknown> | undefined;
  try {
    sessionA = a.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`users:${C.clinicId}`}, 0))`;
      await tx`SELECT id FROM memberships
               WHERE clinic_id = ${C.clinicId} AND id = ${C.doctor.memberId} FOR UPDATE`;
      aHeld.open();
      await aNext.wait;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`branches:${C.clinicId}`}, 0))`;
    });
    await aHeld.wait;
    sessionB = b.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`branches:${C.clinicId}`}, 0))`;
      bHeld.open();
      await bNext.wait;
      await tx`SELECT id FROM branches WHERE clinic_id = ${C.clinicId} AND id = ${C.branchD}
               FOR UPDATE`;
    });
    await bHeld.wait;
    const request = third();
    // (c) waits on the membership row: it does not hold the branch row yet.
    await waitingOnLocks(1);
    aNext.open();
    // (a) waits on `branches:`.
    await waitingOnLocks(2);
    // (b) asks the branch row, which is free because (c) never took it.
    bNext.open();
    return await Promise.allSettled([sessionA, sessionB, request]);
  } finally {
    sessionA?.catch(() => undefined);
    sessionB?.catch(() => undefined);
    await a.end({ timeout: 5 });
    await b.end({ timeout: 5 });
  }
}

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await financeClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  await setPrefixes(h, C);
  // The service line needs a price of its own (issue.db.spec.ts does the same).
  const priced = await send(h, C.admin.cookie, "PATCH", `/v1/services/${C.serviceId}/price`, {
    priceMinor: "15000",
  });
  if (priced.statusCode !== 200) throw new Error(`price ${priced.statusCode} ${priced.body}`);
});

afterAll(async () => {
  await closeHarness(h);
});

describe("the lock order of an issue (ADR-0027, spec §8d item 4)", () => {
  it("lets an issue, a user's branch change and a branch deactivation all complete", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const [ra, rb, rc] = await replay(() =>
      send(
        h,
        C.admin.cookie,
        "POST",
        "/v1/invoices",
        {
          source: "manual",
          sourceId: null,
          patientId: patient,
          branchId: C.branchD,
          lines: [serviceLine("15000")],
          invoiceDiscount: null,
        },
        randomUUID(),
      ),
    );
    expect(ra.status).toBe("fulfilled");
    expect(rb.status).toBe("fulfilled");
    expect(rc.status === "fulfilled" ? rc.value.statusCode : rc.reason).toBe(201);
  });
});
