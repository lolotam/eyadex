import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { settledOrBlocked } from "../../identity/__tests__/access-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  auditOf,
  code,
  schedulingClinic,
  send,
  setAppointmentsModule,
} from "./scheduling-fixtures.ts";

// D-6, D-13, D-14 and the branch scope of spec §3 (ADR-0026 §3–§4).
let h: Harness;
let invalidate: AuthorizationInvalidator;
let C: Awaited<ReturnType<typeof schedulingClinic>>;
let other: Awaited<ReturnType<typeof schedulingClinic>>;
const path = (memberId: string) => `/v1/schedules/${memberId}`;
const week = (...rows: [number, string, string][]) => ({
  shifts: rows.map(([weekday, startsAt, endsAt]) => ({ weekday, startsAt, endsAt })),
});
const put = (cookie: string, memberId: string, branchId: string, body: unknown) =>
  send(h, cookie, "PUT", `${path(memberId)}/branches/${branchId}`, body);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const bookable = (memberId: string) =>
  send(h, C.admin.cookie, "PUT", `/v1/users/${memberId}/booking-profile`, {
    acceptsAppointments: true,
    defaultDurationMinutes: 20,
  });

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await schedulingClinic(h, invalidate);
  other = await schedulingClinic(h, invalidate);
  await bookable(C.doctor.memberId);
  await bookable(C.admin.memberId);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("a provider's weekly schedule", () => {
  it("saves a branch week with one audit row; the same week again writes nothing", async () => {
    const body = week([0, "16:00", "20:00"], [0, "08:00", "12:00"]);
    const res = await put(C.admin.cookie, C.doctor.memberId, C.branchD, body);
    expect(res.statusCode).toBe(200);
    expect(res.json().shifts).toEqual([
      { branchId: C.branchD, weekday: 0, startsAt: "08:00", endsAt: "12:00" },
      { branchId: C.branchD, weekday: 0, startsAt: "16:00", endsAt: "20:00" },
    ]);
    expect((await put(C.admin.cookie, C.doctor.memberId, C.branchD, body)).statusCode).toBe(200);
    const rows = (await auditOf(h, C.clinicId, C.doctor.memberId)).filter(
      (r) => r["action"] === "schedule.replaced",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!["details"].after.shifts).toEqual(["0 08:00-12:00", "0 16:00-20:00"]);
  });

  it("D-14: back-to-back rows across midnight are accepted, 24:00 included", async () => {
    const res = await put(
      C.admin.cookie,
      C.doctor.memberId,
      C.branchD,
      week([0, "20:00", "24:00"], [1, "00:00", "01:00"]),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().shifts.map((s: { endsAt: string }) => s.endsAt)).toEqual(["24:00", "01:00"]);
  });

  it("refuses overlapping rows, also against the provider's rows in another branch", async () => {
    const self = await put(
      C.admin.cookie,
      C.doctor.memberId,
      C.branchD,
      week([2, "08:00", "10:00"], [2, "09:00", "11:00"]),
    );
    expect(self.statusCode).toBe(409);
    expect(code(self)).toBe("schedule_overlap");
    expect(
      (await put(C.admin.cookie, C.admin.memberId, C.branchD, week([3, "08:00", "12:00"])))
        .statusCode,
    ).toBe(200);
    const cross = await put(
      C.admin.cookie,
      C.admin.memberId,
      C.branchR,
      week([3, "11:00", "13:00"]),
    );
    expect(code(cross)).toBe("schedule_overlap");
  });

  it("D-13: two saves racing for one provider's overlapping hours — exactly one wins", async () => {
    const [a, b] = await Promise.all([
      put(C.admin.cookie, C.admin.memberId, C.branchX, week([4, "08:00", "12:00"])),
      put(C.admin.cookie, C.admin.memberId, C.branchR, week([4, "10:00", "14:00"])),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  });

  it("D-13: a save waits for the provider lock, then sees the rows written under it", async () => {
    let saving: ReturnType<typeof put> | undefined;
    const lockKey = `appointments:${C.clinicId}:${C.admin.memberId}`;
    await h.owner.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      await tx`INSERT INTO provider_schedules VALUES (${C.clinicId}, ${randomUUID()},
        ${C.admin.memberId}, ${C.branchX}, 6, '08:00', '12:00', now())`;
      saving = put(C.admin.cookie, C.admin.memberId, C.branchR, week([6, "10:00", "14:00"]));
      await settledOrBlocked(h, saving);
    });
    expect(code(await saving!)).toBe("schedule_overlap");
  });

  it("refuses a member who is not bookable, and a branch the provider does not work in", async () => {
    const notBookable = await put(
      C.admin.cookie,
      C.desk.memberId,
      C.branchR,
      week([0, "08:00", "09:00"]),
    );
    expect(notBookable.statusCode).toBe(400);
    expect(code(notBookable)).toBe("provider_not_bookable");
    const elsewhere = await put(
      C.admin.cookie,
      C.doctor.memberId,
      C.branchX,
      week([0, "08:00", "09:00"]),
    );
    expect(code(elsewhere)).toBe("provider_not_in_branch");
  });

  it("validates wall times: HH:MM, start before end, 24:00 only as an end", async () => {
    for (const bad of [
      week([0, "08:00", "08:00"]),
      week([0, "24:00", "24:00"]),
      week([0, "8:00", "09:00"]),
      week([7, "08:00", "09:00"]),
    ]) {
      expect((await put(C.admin.cookie, C.doctor.memberId, C.branchD, bad)).statusCode).toBe(400);
    }
  });
});

describe("rows left in a branch the provider no longer works in (Codex r1)", () => {
  it("are hidden and dormant: they never block hours in the provider's own branches", async () => {
    await bookable(C.desk.memberId);
    // The desk once worked in X: its old row stays (configuration is never silently deleted).
    await h.owner`INSERT INTO provider_schedules VALUES (${C.clinicId}, ${randomUUID()},
      ${C.desk.memberId}, ${C.branchX}, 2, '08:00', '12:00', now())`;
    const res = await put(C.admin.cookie, C.desk.memberId, C.branchR, week([2, "10:00", "14:00"]));
    expect(res.statusCode).toBe(200);
    expect(res.json().shifts).toEqual([
      { branchId: C.branchR, weekday: 2, startsAt: "10:00", endsAt: "14:00" },
    ]);
  });
});

describe("branch scope (spec §3)", () => {
  it("a front desk on branch R edits a provider in R only and never sees providers outside R", async () => {
    expect(
      (await put(C.desk.cookie, C.admin.memberId, C.branchR, week([5, "08:00", "09:00"])))
        .statusCode,
    ).toBe(200);
    const outside = await put(
      C.desk.cookie,
      C.admin.memberId,
      C.branchD,
      week([5, "08:00", "09:00"]),
    );
    expect(code(outside)).toBe("forbidden");
    expect((await send(h, C.desk.cookie, "GET", path(C.doctor.memberId))).statusCode).toBe(404);
    const providers = (await send(h, C.desk.cookie, "GET", "/v1/schedules/providers")).json().items;
    const ids = providers.map((p: { membershipId: string }) => p.membershipId);
    expect(ids).toContain(C.admin.memberId);
    expect(ids).not.toContain(C.doctor.memberId);
    const seen = (await send(h, C.desk.cookie, "GET", path(C.admin.memberId))).json();
    expect(seen.branches.map((b: { id: string }) => b.id)).toEqual([C.branchR]);
    expect(seen.shifts.every((s: { branchId: string }) => s.branchId === C.branchR)).toBe(true);
  });

  it("NEGATIVE: time off needs update:schedules:clinic; another clinic's member is not found", async () => {
    const body = { startsAt: inDays(1), endsAt: inDays(2), note: null };
    expect(
      code(await send(h, C.desk.cookie, "POST", `${path(C.admin.memberId)}/time-off`, body)),
    ).toBe("forbidden");
    expect((await send(h, C.admin.cookie, "GET", path(other.doctor.memberId))).statusCode).toBe(
      404,
    );
  });
});

describe("time off (D-6)", () => {
  it("adds, shows, cancels once; the note never reaches the audit log", async () => {
    const body = { startsAt: inDays(3), endsAt: inDays(4), note: "private reason" };
    const added = await send(
      h,
      C.admin.cookie,
      "POST",
      `${path(C.doctor.memberId)}/time-off`,
      body,
    );
    expect(added.statusCode).toBe(201);
    const off = added
      .json()
      .timeOff.find((t: { note: string | null }) => t.note === "private reason");
    expect(off).toBeDefined();
    const cancel = `${path(C.doctor.memberId)}/time-off/${off.id}/cancel`;
    const cancelled = await send(h, C.admin.cookie, "POST", cancel);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().timeOff.map((t: { id: string }) => t.id)).not.toContain(off.id);
    expect((await send(h, C.admin.cookie, "POST", cancel)).statusCode).toBe(200);
    const rows = await auditOf(h, C.clinicId, off.id);
    expect(rows.map((r) => r["action"])).toEqual(["time_off.added", "time_off.cancelled"]);
    expect(rows.map((r) => r["raw"]).join(" ")).not.toContain("private reason");
  });

  it("refuses an end before the start (400)", async () => {
    const body = { startsAt: inDays(2), endsAt: inDays(1), note: null };
    expect(
      (await send(h, C.admin.cookie, "POST", `${path(C.doctor.memberId)}/time-off`, body))
        .statusCode,
    ).toBe(400);
  });
});

describe("the module flag (rule 10)", () => {
  it("NEGATIVE: every schedules route answers module_disabled while the module is off", async () => {
    await setAppointmentsModule(h, invalidate, C.clinicId, false);
    try {
      const routes = [
        send(h, C.admin.cookie, "GET", "/v1/schedules/providers"),
        send(h, C.admin.cookie, "GET", path(C.doctor.memberId)),
        put(C.admin.cookie, C.doctor.memberId, C.branchD, week()),
        send(h, C.admin.cookie, "POST", `${path(C.doctor.memberId)}/time-off`, {
          startsAt: inDays(1),
          endsAt: inDays(2),
          note: null,
        }),
      ];
      for (const res of await Promise.all(routes)) expect(code(res)).toBe("module_disabled");
    } finally {
      await setAppointmentsModule(h, invalidate, C.clinicId, true);
    }
  });
});

describe("an inactive branch (Codex r3)", () => {
  it("is hidden with its hours, as the dormant rows it holds", async () => {
    await h.owner`INSERT INTO provider_schedules VALUES (${C.clinicId}, ${randomUUID()},
      ${C.admin.memberId}, ${C.branchX}, 0, '06:00', '07:00', now())`;
    await h.owner`UPDATE branches SET is_active = false WHERE id = ${C.branchX}`;
    try {
      const seen = (await send(h, C.admin.cookie, "GET", path(C.admin.memberId))).json();
      expect(seen.branches.map((b: { id: string }) => b.id)).not.toContain(C.branchX);
      expect(seen.shifts.some((s: { branchId: string }) => s.branchId === C.branchX)).toBe(false);
    } finally {
      await h.owner`UPDATE branches SET is_active = true WHERE id = ${C.branchX}`;
    }
  });
});
