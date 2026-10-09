import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { auditOf, code, schedulingClinic, send } from "./scheduling-fixtures.ts";

// Dormant rows: rows kept in an inactive branch or one the provider left. They still count for the
// no-overlap rule (Codex PR #63 P2), are shown inside the caller's reach, and are cleared by an empty
// week (ADR-0026 §4).
let h: Harness;
let C: Awaited<ReturnType<typeof schedulingClinic>>;
const path = (memberId: string) => `/v1/schedules/${memberId}`;
const week = (...rows: [number, string, string][]) => ({
  shifts: rows.map(([weekday, startsAt, endsAt]) => ({ weekday, startsAt, endsAt })),
});
const put = (cookie: string, memberId: string, branchId: string, body: unknown) =>
  send(h, cookie, "PUT", `${path(memberId)}/branches/${branchId}`, body);
const ids = (list: { id: string }[]) => list.map((b) => b.id);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const keepRow = (memberId: string, branchId: string, weekday: number, from: string, to: string) =>
  h.owner`INSERT INTO provider_schedules VALUES (${C.clinicId}, ${randomUUID()},
    ${memberId}, ${branchId}, ${weekday}, ${from}, ${to}, now())`;
const setActive = (branchId: string, active: boolean) =>
  h.owner`UPDATE branches SET is_active = ${active} WHERE id = ${branchId}`;

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await schedulingClinic(h, invalidate);
  for (const memberId of [C.doctor.memberId, C.admin.memberId]) {
    await send(h, C.admin.cookie, "PUT", `/v1/users/${memberId}/booking-profile`, {
      acceptsAppointments: true,
      defaultDurationMinutes: 20,
    });
  }
});
afterAll(async () => {
  await closeHarness(h);
});

describe("rows left in a branch the provider no longer works in", () => {
  it("are shown, block an overlapping week naming the branch, and clear with an empty week", async () => {
    // The doctor (branch D) once worked in R: the old row stays.
    await keepRow(C.doctor.memberId, C.branchR, 2, "08:00", "12:00");
    const seen = (await send(h, C.admin.cookie, "GET", path(C.doctor.memberId))).json();
    expect(ids(seen.branches)).toEqual([C.branchD]);
    expect(ids(seen.dormantBranches)).toEqual([C.branchR]);
    expect(seen.shifts).toContainEqual({
      branchId: C.branchR,
      weekday: 2,
      startsAt: "08:00",
      endsAt: "12:00",
    });

    const blocked = await put(
      C.admin.cookie,
      C.doctor.memberId,
      C.branchD,
      week([2, "10:00", "14:00"]),
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({
      code: "schedule_overlap",
      details: { branchId: C.branchR },
    });

    const refill = await put(
      C.admin.cookie,
      C.doctor.memberId,
      C.branchR,
      week([2, "08:00", "09:00"]),
    );
    expect(code(refill)).toBe("provider_not_in_branch");

    const cleared = await put(C.admin.cookie, C.doctor.memberId, C.branchR, week());
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().dormantBranches).toEqual([]);
    const audit = (await auditOf(h, C.clinicId, C.doctor.memberId)).filter(
      (r) => r["action"] === "schedule.replaced",
    );
    expect(audit.at(-1)!["details"]).toMatchObject({
      before: { branchId: C.branchR, shifts: ["2 08:00-12:00"] },
      after: { branchId: C.branchR, shifts: [] },
    });

    const saved = await put(
      C.admin.cookie,
      C.doctor.memberId,
      C.branchD,
      week([2, "10:00", "14:00"]),
    );
    expect(saved.statusCode).toBe(200);
  });
});

describe("rows of an inactive branch", () => {
  it("are shown, block an overlapping week naming the branch, and clear with an empty week", async () => {
    await keepRow(C.admin.memberId, C.branchX, 0, "06:00", "07:00");
    await setActive(C.branchX, false);
    try {
      const seen = (await send(h, C.admin.cookie, "GET", path(C.admin.memberId))).json();
      expect(ids(seen.branches)).not.toContain(C.branchX);
      expect(seen.dormantBranches).toEqual([
        expect.objectContaining({ id: C.branchX, isActive: false }),
      ]);
      expect(
        seen.shifts.filter((s: { branchId: string }) => s.branchId === C.branchX),
      ).toHaveLength(1);

      const body = week([0, "06:30", "08:00"]);
      const blocked = await put(C.admin.cookie, C.admin.memberId, C.branchD, body);
      expect(blocked.json()).toMatchObject({
        code: "schedule_overlap",
        details: { branchId: C.branchX },
      });
      const refill = await put(
        C.admin.cookie,
        C.admin.memberId,
        C.branchX,
        week([0, "06:00", "07:00"]),
      );
      expect(code(refill)).toBe("branch_inactive");
      expect((await put(C.admin.cookie, C.admin.memberId, C.branchX, week())).statusCode).toBe(200);
      expect((await put(C.admin.cookie, C.admin.memberId, C.branchD, body)).statusCode).toBe(200);
    } finally {
      await setActive(C.branchX, true);
    }
  });
});

describe("branch scope (spec §3) and dormant rows", () => {
  it("NEGATIVE: a front desk on R neither sees, clears nor learns of dormant rows outside R", async () => {
    await keepRow(C.admin.memberId, C.branchX, 3, "06:00", "07:00");
    await setActive(C.branchX, false);
    try {
      const seen = (await send(h, C.desk.cookie, "GET", path(C.admin.memberId))).json();
      expect(seen.dormantBranches).toEqual([]);
      expect(seen.shifts.every((s: { branchId: string }) => s.branchId === C.branchR)).toBe(true);
      expect(code(await put(C.desk.cookie, C.admin.memberId, C.branchX, week()))).toBe("forbidden");
      const blocked = await put(
        C.desk.cookie,
        C.admin.memberId,
        C.branchR,
        week([3, "06:30", "08:00"]),
      );
      expect(code(blocked)).toBe("schedule_overlap");
      expect(blocked.json().details).toBeUndefined();
      // The clinic-scope admin still sees the row and can clear it.
      const admin = (await send(h, C.admin.cookie, "GET", path(C.admin.memberId))).json();
      expect(ids(admin.dormantBranches)).toEqual([C.branchX]);
    } finally {
      await setActive(C.branchX, true);
    }
  });
});

describe("the schedule a write answers with (Codex PR #63)", () => {
  // Views branch R only, edits every branch: a combination the role editor accepts.
  let editor: Awaited<ReturnType<typeof memberOn>>;
  beforeAll(async () => {
    const keys = ["view:schedules:branch", "update:schedules:clinic"];
    const role = await customRole(h, C.clinicId, keys);
    editor = await memberOn(h, C.admin, role, { allBranches: false, branchIds: [C.branchR] });
  });

  it("NEGATIVE: is clipped to the caller's view keys, not the wider write key", async () => {
    await keepRow(C.admin.memberId, C.branchX, 4, "06:00", "07:00");
    await setActive(C.branchX, false);
    try {
      const res = await put(
        editor.cookie,
        C.admin.memberId,
        C.branchD,
        week([4, "15:00", "16:00"]),
      );
      expect(res.statusCode).toBe(200);
      const seen = res.json();
      expect({
        allBranches: seen.provider.allBranches,
        branchIds: seen.provider.branchIds,
      }).toEqual({
        allBranches: false,
        branchIds: [C.branchR],
      });
      expect(ids(seen.branches)).toEqual([C.branchR]);
      expect(seen.dormantBranches).toEqual([]);
      expect(seen.shifts.every((s: { branchId: string }) => s.branchId === C.branchR)).toBe(true);
      // A clash with a branch it cannot view is not named either.
      const blocked = await put(
        editor.cookie,
        C.admin.memberId,
        C.branchD,
        week([4, "06:30", "08:00"]),
      );
      expect(code(blocked)).toBe("schedule_overlap");
      expect(blocked.json().details).toBeUndefined();
    } finally {
      await setActive(C.branchX, true);
    }
  });

  it("NEGATIVE: hides the time off of a provider the view keys do not reach (Codex r2)", async () => {
    const off = { startsAt: inDays(5), endsAt: inDays(6), note: "private reason" };
    // The doctor works in D only, outside the editor's view: its GET is not_found.
    expect((await send(h, editor.cookie, "GET", path(C.doctor.memberId))).statusCode).toBe(404);
    const added = await send(h, editor.cookie, "POST", `${path(C.doctor.memberId)}/time-off`, off);
    expect(added.statusCode).toBe(201);
    expect(added.json().timeOff).toEqual([]);
    const saved = await put(
      editor.cookie,
      C.doctor.memberId,
      C.branchD,
      week([5, "08:00", "09:00"]),
    );
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ timeOff: [], branches: [], shifts: [] });
    expect(saved.body).not.toContain("private reason");
  });
});
