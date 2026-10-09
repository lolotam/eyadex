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

// D-1, D-15 (ADR-0026 §5): "accepts appointments" + default duration on the user editor.
let h: Harness;
let invalidate: AuthorizationInvalidator;
let C: Awaited<ReturnType<typeof schedulingClinic>>;
let other: Awaited<ReturnType<typeof schedulingClinic>>;
const url = (memberId: string) => `/v1/users/${memberId}/booking-profile`;

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await schedulingClinic(h, invalidate);
  other = await schedulingClinic(h, invalidate);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("booking profile", () => {
  it("starts not bookable, 20 minutes (D-15)", async () => {
    const res = await send(h, C.admin.cookie, "GET", url(C.doctor.memberId));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      memberId: C.doctor.memberId,
      acceptsAppointments: false,
      defaultDurationMinutes: 20,
    });
  });

  it("the admin turns it on with one audit row; the same values again write nothing", async () => {
    const body = { acceptsAppointments: true, defaultDurationMinutes: 30 };
    const first = await send(h, C.admin.cookie, "PUT", url(C.doctor.memberId), body);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ memberId: C.doctor.memberId, ...body });
    expect((await send(h, C.admin.cookie, "PUT", url(C.doctor.memberId), body)).statusCode).toBe(
      200,
    );
    const rows = (await auditOf(h, C.clinicId, C.doctor.memberId)).filter(
      (r) => r["action"] === "user.booking_changed",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!["category"]).toBe("administrative");
    expect(rows[0]!["details"]).toMatchObject({
      before: { acceptsAppointments: false, defaultDurationMinutes: 20 },
      after: { acceptsAppointments: true, defaultDurationMinutes: 30 },
    });
  });

  it("refuses a duration outside 5–480 minutes (D-15)", async () => {
    for (const minutes of [4, 481, 12.5]) {
      const body = { acceptsAppointments: true, defaultDurationMinutes: minutes };
      const res = await send(h, C.admin.cookie, "PUT", url(C.doctor.memberId), body);
      expect(res.statusCode).toBe(400);
      expect(code(res)).toBe("validation");
    }
  });

  it("NEGATIVE: needs the users keys, never a role name", async () => {
    expect(code(await send(h, C.desk.cookie, "GET", url(C.doctor.memberId)))).toBe("forbidden");
    const body = { acceptsAppointments: true, defaultDurationMinutes: 20 };
    expect(code(await send(h, C.desk.cookie, "PUT", url(C.doctor.memberId), body))).toBe(
      "forbidden",
    );
  });

  it("NEGATIVE: another clinic's member and a malformed id are not found", async () => {
    expect((await send(h, C.admin.cookie, "GET", url(other.doctor.memberId))).statusCode).toBe(404);
    expect((await send(h, C.admin.cookie, "GET", url("not-a-uuid"))).statusCode).toBe(404);
  });

  it("NEGATIVE: the module switched off answers module_disabled on both routes", async () => {
    await setAppointmentsModule(h, invalidate, C.clinicId, false);
    try {
      expect(code(await send(h, C.admin.cookie, "GET", url(C.doctor.memberId)))).toBe(
        "module_disabled",
      );
      const body = { acceptsAppointments: false, defaultDurationMinutes: 20 };
      const put = await send(h, C.admin.cookie, "PUT", url(C.doctor.memberId), body);
      expect(put.statusCode).toBe(403);
      expect(code(put)).toBe("module_disabled");
    } finally {
      await setAppointmentsModule(h, invalidate, C.clinicId, true);
    }
  });
});

// Codex r1: a schedule save holds the provider lock and then needs the membership row (its FK), so a
// booking-profile change must wait for the provider lock before it locks that row — never the reverse.
describe("lock order (D-13)", () => {
  it("waits for the provider lock without holding the membership row", async () => {
    let saving: ReturnType<typeof send> | undefined;
    const key = `appointments:${C.clinicId}:${C.doctor.memberId}`;
    await h.owner.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const body = { acceptsAppointments: true, defaultDurationMinutes: 25 };
      saving = send(h, C.admin.cookie, "PUT", url(C.doctor.memberId), body);
      await settledOrBlocked(h, saving);
      // What a schedule INSERT's foreign key takes; NOWAIT fails at once if the row is held.
      await tx`SELECT 1 FROM memberships WHERE clinic_id = ${C.clinicId}
                 AND id = ${C.doctor.memberId} FOR KEY SHARE NOWAIT`;
    });
    expect((await saving!).statusCode).toBe(200);
  });
});
