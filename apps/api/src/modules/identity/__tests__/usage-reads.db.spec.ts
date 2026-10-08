import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers, get } from "./access-fixtures.ts";
import { setMaxBranches } from "./branch-fixtures.ts";
import { invite, inviteBody, roleIdOf, setMaxUsers } from "./user-fixtures.ts";

// ADR-0016: the clinic-side counters read the same rules as the limit checks, inside the clinic.
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let B: Awaited<ReturnType<typeof clinicWithMembers>>;

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  B = await clinicWithMembers(h);
  await setMaxBranches(h, A.admin.clinicId, 7);
  await setMaxBranches(h, B.admin.clinicId, 9);
  await setMaxUsers(h, A.admin.clinicId, 17);
  await setMaxUsers(h, B.admin.clinicId, 19);
});

afterAll(async () => {
  await closeHarness(h);
});

const activeBranches = async (clinicId: string) =>
  Number(
    (
      await h.owner`SELECT count(*)::int AS n FROM branches
                    WHERE clinic_id = ${clinicId} AND is_active`
    )[0]!["n"],
  );
const seats = async (clinicId: string) =>
  Number(
    (
      await h.owner`SELECT
        (SELECT count(*) FROM memberships WHERE clinic_id = ${clinicId} AND status = 'active') +
        (SELECT count(*) FROM invitations WHERE clinic_id = ${clinicId} AND status = 'pending'
           AND expires_at > now()) AS n`
    )[0]!["n"],
  );

describe("GET /v1/branches/usage", () => {
  it("answers the clinic's own active branches and limit", async () => {
    const res = await get(h, "/v1/branches/usage", A.admin.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ active: await activeBranches(A.admin.clinicId), limit: 7 });
  });

  it("NEGATIVE: another clinic's admin sees only their own clinic", async () => {
    const res = await get(h, "/v1/branches/usage", B.admin.cookie);
    expect(res.json()).toEqual({ active: await activeBranches(B.admin.clinicId), limit: 9 });
  });

  it("NEGATIVE: without view:branches:clinic → 403; on the platform host → 404", async () => {
    const res = await get(h, "/v1/branches/usage", A.doctor.cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("forbidden");
    expect((await get(h, "/v1/branches/usage", A.admin.cookie, PLATFORM)).statusCode).toBe(404);
  });
});

describe("GET /v1/users/usage", () => {
  it("counts active members plus live pending invitations", async () => {
    const before = (await get(h, "/v1/users/usage", A.admin.cookie)).json();
    expect(before).toEqual({ used: await seats(A.admin.clinicId), limit: 17 });
    const roleId = await roleIdOf(h, A.admin.clinicId, "doctor");
    expect((await invite(h, A.admin.cookie, inviteBody(roleId), undefined, APP)).statusCode).toBe(
      201,
    );
    const after = (await get(h, "/v1/users/usage", A.admin.cookie)).json();
    expect(after.used).toBe(before.used + 1);
  });

  it("NEGATIVE: another clinic's admin sees only their own clinic", async () => {
    const res = await get(h, "/v1/users/usage", B.admin.cookie);
    expect(res.json()).toEqual({ used: await seats(B.admin.clinicId), limit: 19 });
  });

  it("NEGATIVE: without view:users:clinic → 403", async () => {
    const res = await get(h, "/v1/users/usage", A.doctor.cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("forbidden");
  });
});
