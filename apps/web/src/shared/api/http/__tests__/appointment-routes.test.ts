import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { BRANCH, CLINIC, TS, USER, clientWith, me, type Call } from "./fetch-stub";

// Appointments over HTTP (slice A2): method, path, query, body and key header of every call.
const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const APPT = "0190a000-0000-7000-8000-0000000000c1";
const PATIENT = "0190a000-0000-7000-8000-0000000000c2";
const branch = { id: BRANCH, nameAr: "ف", nameEn: "B", isActive: true };
const appointment = {
  id: APPT,
  branchId: BRANCH,
  providerMembershipId: USER,
  providerName: "Dr A",
  patientId: PATIENT,
  patientName: "P",
  patientFileNumber: 7,
  serviceId: null,
  serviceNameAr: null,
  serviceNameEn: null,
  startsAt: TS,
  endsAt: "2026-01-01T00:20:00.000Z",
  status: "booked",
  overbooked: false,
  cancelReason: null,
  cancelNote: null,
};
const day = {
  branch,
  date: "2026-01-01",
  timezone: "Asia/Kuwait",
  providers: [],
  appointments: [appointment],
  can: { create: true, update: true, overbook: false },
};

function answer(call: Call) {
  const path = call.url.replace(/\?.*$/, "");
  if (path === "/api/v1/me") return { body: me };
  if (path === "/api/v1/appointments/branches") return { body: { items: [branch] } };
  if (path === "/api/v1/appointments/day") return { body: day };
  return {
    body: { appointment },
    status: call.method === "POST" && path.endsWith("appointments") ? 201 : 200,
  };
}

let h: ReturnType<typeof clientWith>;
beforeEach(() => {
  h = clientWith(answer);
});
const last = () => h.calls.at(-1)!;

describe("appointments over HTTP", () => {
  it("reads the branches and one branch day with its query", async () => {
    expect(await h.api.appointments.listBranches(P)).toEqual({ items: [branch] });
    expect(await h.api.appointments.day(P, { branchId: BRANCH, date: "2026-01-01" })).toEqual(day);
    expect(last().url).toBe(`/api/v1/appointments/day?branchId=${BRANCH}&date=2026-01-01`);
  });

  it("creates with the Idempotency-Key and only the contract's fields", async () => {
    const input = {
      branchId: BRANCH,
      providerMembershipId: USER,
      patientId: PATIENT,
      serviceId: null,
      startsAt: TS,
      endsAt: null,
      overbook: false,
    };
    const res = await h.api.appointments.create(P, { ...input, extra: 1 } as typeof input, "k-1");
    expect(res.appointment?.id).toBe(APPT);
    expect(last()).toMatchObject({ method: "POST", url: "/api/v1/appointments", body: input });
    expect(last().headers["Idempotency-Key"]).toBe("k-1");
  });

  it("reschedules, sets a status and cancels by id", async () => {
    const move = {
      branchId: BRANCH,
      providerMembershipId: USER,
      startsAt: TS,
      endsAt: "2026-01-01T00:30:00.000Z",
      overbook: true,
    };
    await h.api.appointments.reschedule(P, APPT, move);
    expect(last()).toMatchObject({
      method: "PUT",
      url: `/api/v1/appointments/${APPT}`,
      body: move,
    });
    await h.api.appointments.setStatus(P, APPT, { status: "arrived" });
    expect(last()).toMatchObject({
      method: "POST",
      url: `/api/v1/appointments/${APPT}/status`,
      body: { status: "arrived" },
    });
    await h.api.appointments.cancel(P, APPT, { reason: "other", note: null });
    expect(last()).toMatchObject({
      url: `/api/v1/appointments/${APPT}/cancel`,
      body: { reason: "other", note: null },
    });
  });
});
