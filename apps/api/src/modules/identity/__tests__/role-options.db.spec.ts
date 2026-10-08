import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  branchOptionListResponseSchema,
  roleOptionListResponseSchema,
} from "@eyadex/contracts/role-admin";

import {
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers, get } from "./access-fixtures.ts";
import { branchAction, code, createBranch } from "./branch-fixtures.ts";
import { customRole, memberOn, setMaxUsers } from "./user-fixtures.ts";

// The user editor's pickers under view:users only (ADR-0017; Codex on PR #46).
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let B: Awaited<ReturnType<typeof clinicWithMembers>>;
let usersViewer: Awaited<ReturnType<typeof memberOn>>;
let inactiveRole: string;
let inactiveBranch: string;

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  B = await clinicWithMembers(h);
  await setMaxUsers(h, A.admin.clinicId, 50);
  await h.owner`UPDATE clinics SET max_branches = 50 WHERE id = ${A.admin.clinicId}`;
  usersViewer = await memberOn(
    h,
    A.admin,
    await customRole(h, A.admin.clinicId, ["view:users:clinic"]),
  );
  inactiveRole = await customRole(h, A.admin.clinicId, []);
  await h.owner`UPDATE roles SET is_active = false WHERE id = ${inactiveRole}`;
  inactiveBranch = (await createBranch(h, A.admin.cookie)).json().id as string;
  expect((await branchAction(h, A.admin.cookie, inactiveBranch, "deactivate")).statusCode).toBe(
    200,
  );
});

afterAll(async () => {
  await closeHarness(h);
});

const ids = async (clinicId: string, table: "roles" | "branches") =>
  (await h.owner`SELECT id FROM ${h.owner(table)} WHERE clinic_id = ${clinicId} ORDER BY id`).map(
    (r) => r["id"] as string,
  );

describe("role and branch options need view:users only", () => {
  it("a member with view:users but neither view:roles nor view:branches gets both lists", async () => {
    expect((await get(h, "/v1/roles", usersViewer.cookie)).statusCode).toBe(403);
    expect((await get(h, "/v1/branches", usersViewer.cookie)).statusCode).toBe(403);
    const roles = roleOptionListResponseSchema.parse(
      (await get(h, "/v1/users/role-options?limit=100", usersViewer.cookie)).json(),
    );
    const branches = branchOptionListResponseSchema.parse(
      (await get(h, "/v1/users/branch-options?limit=100", usersViewer.cookie)).json(),
    );
    expect(roles.items.map((r) => r.id)).toEqual(await ids(A.admin.clinicId, "roles"));
    expect(branches.items.map((b) => b.id)).toEqual(await ids(A.admin.clinicId, "branches"));
    expect(roles.items.find((r) => r.id === inactiveRole)?.isActive).toBe(false);
    expect(branches.items.find((b) => b.id === inactiveBranch)?.isActive).toBe(false);
  });

  it("answers the minimal fields only", async () => {
    for (const path of ["/v1/users/role-options", "/v1/users/branch-options"]) {
      const page = (await get(h, path, A.admin.cookie)).json() as { items: object[] };
      for (const item of page.items) {
        expect(Object.keys(item).sort()).toEqual(["id", "isActive", "nameAr", "nameEn"]);
      }
    }
  });

  it("pages with a cursor and a separate total", async () => {
    const first = roleOptionListResponseSchema.parse(
      (await get(h, "/v1/users/role-options?limit=2", A.admin.cookie)).json(),
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = roleOptionListResponseSchema.parse(
      (
        await get(h, `/v1/users/role-options?limit=2&cursor=${first.nextCursor}`, A.admin.cookie)
      ).json(),
    );
    expect(second.total).toBe(first.total);
    expect(second.items[0]!.id > first.items[1]!.id).toBe(true);
  });
});

describe("guards", () => {
  for (const path of ["/v1/users/role-options", "/v1/users/branch-options"]) {
    it(`NEGATIVE ${path}: a role without view:users gets 403`, async () => {
      const res = await get(h, path, A.doctor.cookie);
      expect(res.statusCode).toBe(403);
      expect(code(res)).toBe("forbidden");
    });
    it(`${path}: no session gets 401, the platform host 404`, async () => {
      expect((await get(h, path)).statusCode).toBe(401);
      expect((await get(h, path, A.admin.cookie, PLATFORM)).statusCode).toBe(404);
    });
    it(`NEGATIVE ${path} (ISO-02): another clinic's rows are never listed`, async () => {
      const table = path.endsWith("role-options") ? "roles" : "branches";
      // Each clinic lists exactly its own rows, so a leak shows whichever clinic is older.
      for (const clinic of [A, B]) {
        const page = (await get(h, `${path}?limit=100`, clinic.admin.cookie)).json() as {
          items: { id: string }[];
          total: number;
        };
        const own = await ids(clinic.admin.clinicId, table);
        expect(page.items.map((item) => item.id)).toEqual(own);
        expect(page.total).toBe(own.length);
      }
    });
  }
});
