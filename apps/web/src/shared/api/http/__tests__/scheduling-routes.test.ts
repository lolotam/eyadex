import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { BRANCH, CLINIC, TS, USER, clientWith, me, type Call } from "./fetch-stub";

// The appointments settings over HTTP (ADR-0026): method, path, body, key header of every call.
const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const SERVICE = "0190a000-0000-7000-8000-0000000000b1";
const OFF = "0190a000-0000-7000-8000-0000000000b2";
const service = {
  id: SERVICE,
  nameAr: "ليزر",
  nameEn: "Laser",
  durationMinutes: 30,
  status: "active",
  createdAt: TS,
};
const provider = {
  membershipId: USER,
  fullName: "Dr A",
  defaultDurationMinutes: 20,
  allBranches: false,
  branchIds: [BRANCH],
};
const schedule = {
  provider,
  branches: [{ id: BRANCH, nameAr: "ف", nameEn: "B", isActive: true }],
  dormantBranches: [],
  shifts: [{ branchId: BRANCH, weekday: 0, startsAt: "20:00", endsAt: "24:00" }],
  timeOff: [{ id: OFF, startsAt: TS, endsAt: "2026-01-02T00:00:00.000Z", note: null }],
};
const profile = { memberId: USER, acceptsAppointments: true, defaultDurationMinutes: 30 };

function answer(call: Call) {
  const path = call.url.replace(/\?.*$/, "");
  if (path === "/api/v1/me") return { body: me };
  if (path === "/api/v1/services") {
    if (call.method === "GET") return { body: { items: [service], nextCursor: null, total: 1 } };
    return { body: service, status: 201 };
  }
  if (path.startsWith("/api/v1/services/")) return { body: service };
  if (path.endsWith("/booking-profile")) return { body: profile };
  if (path === "/api/v1/schedules/providers") return { body: { items: [provider] } };
  if (call.method === "GET") return { body: schedule };
  // A write answers with the schedule, or with none when the view keys cannot see the provider.
  const body = path.endsWith("/cancel") ? { schedule: null } : { schedule };
  return { body, status: path.endsWith("/time-off") ? 201 : 200 };
}

let h: ReturnType<typeof clientWith>;
beforeEach(() => {
  h = clientWith(answer);
});
const last = () => h.calls.at(-1)!;

describe("scheduling over HTTP", () => {
  it("services: list with its query, create with the key, update/deactivate/reactivate by id", async () => {
    const page = await h.api.scheduling.listServices(P, {
      cursor: "Ng",
      limit: 20,
      status: "active",
    });
    expect(page).toEqual({ items: [service], nextCursor: null, total: 1 });
    expect(last().url).toBe("/api/v1/services?cursor=Ng&limit=20&status=active");
    const input = { nameAr: "ليزر", nameEn: "Laser", durationMinutes: 30 };
    await h.api.scheduling.createService(P, input, "key-1");
    expect(last()).toMatchObject({ method: "POST", url: "/api/v1/services", body: input });
    expect(last().headers["Idempotency-Key"]).toBe("key-1");
    await h.api.scheduling.updateService(P, SERVICE, input);
    expect(last()).toMatchObject({
      method: "PUT",
      url: `/api/v1/services/${SERVICE}`,
      body: input,
    });
    await h.api.scheduling.deactivateService(P, SERVICE);
    expect(last()).toMatchObject({ method: "POST", url: `/api/v1/services/${SERVICE}/deactivate` });
    await h.api.scheduling.reactivateService(P, SERVICE);
    expect(last().url).toBe(`/api/v1/services/${SERVICE}/reactivate`);
  });

  it("booking profile: GET and PUT on the member's route, only the two fields sent", async () => {
    expect(await h.api.scheduling.getBookingProfile(P, USER)).toEqual(profile);
    const input = { acceptsAppointments: true, defaultDurationMinutes: 30, extra: 1 };
    await h.api.scheduling.setBookingProfile(P, USER, input);
    expect(last()).toMatchObject({
      method: "PUT",
      url: `/api/v1/users/${USER}/booking-profile`,
      body: { acceptsAppointments: true, defaultDurationMinutes: 30 },
    });
  });

  it("schedules: providers, one provider, a branch week, time off add and cancel", async () => {
    expect(await h.api.scheduling.listProviders(P)).toEqual([provider]);
    expect(await h.api.scheduling.getProviderSchedule(P, USER)).toEqual(schedule);
    const week = { shifts: [{ weekday: 0, startsAt: "20:00", endsAt: "24:00" }] };
    expect(await h.api.scheduling.replaceBranchSchedule(P, USER, BRANCH, week)).toEqual({
      schedule,
    });
    expect(last()).toMatchObject({
      method: "PUT",
      url: `/api/v1/schedules/${USER}/branches/${BRANCH}`,
      body: week,
    });
    const off = { startsAt: TS, endsAt: "2026-01-02T00:00:00.000Z", note: null };
    await h.api.scheduling.addTimeOff(P, USER, off);
    expect(last()).toMatchObject({
      method: "POST",
      url: `/api/v1/schedules/${USER}/time-off`,
      body: off,
    });
    expect(await h.api.scheduling.cancelTimeOff(P, USER, OFF)).toEqual({ schedule: null });
    expect(last().url).toBe(`/api/v1/schedules/${USER}/time-off/${OFF}/cancel`);
  });
});
