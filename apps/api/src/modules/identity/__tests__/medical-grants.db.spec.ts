import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeHarness, openHarness, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "./access-fixtures.ts";
import { code } from "./branch-fixtures.ts";
import { createRole, names, patchRole, roleRow } from "./role-fixtures.ts";
import { act, customRole, memberOn, roleIdOf, setMaxUsers } from "./user-fixtures.ts";

// P2 spec §2, R1-2: the locked clinic admin hands the medical keys to other roles without holding them;
// nobody else grants a key it lacks, and nobody changes its own role.
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let doctorRole: string;

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  await setMaxUsers(h, A.admin.clinicId, 50);
  await h.owner`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
                VALUES (${A.admin.clinicId}, gen_random_uuid(), 'medical', true, now())
                ON CONFLICT (clinic_id, module) DO UPDATE SET enabled = true`;
  doctorRole = await roleIdOf(h, A.admin.clinicId, "doctor");
});

afterAll(async () => {
  await closeHarness(h);
});

describe("granting the medical keys (R1-2)", () => {
  it("the admin, holding no medical key, gives view:medical:own to the doctor role", async () => {
    const res = await patchRole(h, A.admin.cookie, doctorRole, {
      ...names("Doctor"),
      permissionKeys: ["view:patients:own", "view:medical:own"],
    });
    expect(res.statusCode).toBe(200);
    expect((await roleRow(h, doctorRole)).keys).toContain("view:medical:own");
  });

  it("NEGATIVE: the admin moving itself onto that role is role_self_change; nothing changes", async () => {
    // A second admin, so the last-admin rule (checked first, as in the web mock) does not answer.
    await memberOn(h, A.admin, await roleIdOf(h, A.admin.clinicId, "clinic_admin"));
    const [self] = await h.owner`SELECT id, role_id FROM memberships
                                 WHERE clinic_id = ${A.admin.clinicId} AND user_id = ${A.admin.userId}`;
    const res = await act(
      h,
      A.admin.cookie,
      `/v1/users/${self!["id"]}/role`,
      { roleId: doctorRole },
      "PATCH",
    );
    expect([res.statusCode, code(res)]).toEqual([403, "role_self_change"]);
    const [after] = await h.owner`SELECT role_id FROM memberships WHERE id = ${self!["id"]}`;
    expect(after!["role_id"]).toBe(self!["role_id"]);
  });

  it("NEGATIVE: a member holding view:medical:own cannot grant it to another role", async () => {
    const keys = ["view:medical:own", "view:roles:clinic", "create:roles:clinic"];
    const holder = await memberOn(h, A.admin, await customRole(h, A.admin.clinicId, keys));
    const res = await createRole(h, holder.cookie, {
      ...names(),
      permissionKeys: ["view:medical:own"],
    });
    expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
  });
});
