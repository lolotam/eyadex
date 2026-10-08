import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { createPatient, patientBody, patientsClinic, search } from "./patient-fixtures.ts";

// Codex P1 (slice 9): a replayed create must judge scope on the row it returns, read once under the
// clinic's patients lock — never on an earlier read of a file that has since moved.
let h: Harness;
let C: Awaited<ReturnType<typeof patientsClinic>>;

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await patientsClinic(h);
});
afterAll(async () => {
  await closeHarness(h);
});

/** Until some session waits for a lock on `branches` (the owner holds it); throws if none ever does. */
async function untilBlockedOnBranches(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_locks l
                                JOIN pg_class c ON c.oid = l.relation
                                WHERE NOT l.granted AND c.relname = 'branches'`;
    if (row!["n"] !== 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the replay never reached the branches read");
}

describe("idempotent replay racing a branch move", () => {
  it("a file moved out of the caller's scope mid-replay is not_found, never returned", async () => {
    const key = randomUUID();
    const body = patientBody(C.branchR);
    const first = await createPatient(h, C.receptionist.cookie, body, key);
    expect(first.statusCode).toBe(201);
    const { id } = first.json() as { id: string };
    // Warm the guard's cache: the guard must not be the one waiting on `branches` below.
    expect((await search(h, C.receptionist.cookie)).statusCode).toBe(200);

    let replay: ReturnType<typeof createPatient> | undefined;
    // The owner blocks every read of `branches`, so the replay stops at the read that joins it; the
    // move to branch X (outside the receptionist's scope) commits while the replay waits.
    await h.owner.begin(async (tx) => {
      await tx`LOCK TABLE branches IN ACCESS EXCLUSIVE MODE`;
      replay = createPatient(h, C.receptionist.cookie, body, key);
      await untilBlockedOnBranches();
      await tx`UPDATE patients SET registration_branch_id = ${C.branchX} WHERE id = ${id}`;
    });
    const res = await replay!;
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(body.civilId);
    expect(res.body).not.toContain(id);
  });
});
