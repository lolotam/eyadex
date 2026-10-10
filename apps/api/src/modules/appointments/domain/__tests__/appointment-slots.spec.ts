import {
  APPOINTMENT_STATUSES,
  appointmentCancelSchema,
  appointmentDayQuerySchema,
  appointmentInputSchema,
  appointmentRescheduleSchema,
  appointmentSlotProblems,
  canTransition,
  isReschedulable,
  resolveAppointmentEnd,
  type AppointmentStatus,
} from "@eyadex/contracts/appointments";
import { wallToInstant } from "@eyadex/contracts/clinic-time";
import type { WallShift } from "@eyadex/contracts/schedules";
import { describe, expect, it } from "vitest";

// Spec §4 rules 2, 4, 5 and D-5, D-6, D-14, D-15: the pure rules the API and the web mock share.
const TZ = "Asia/Kuwait";
// 2026-10-11 is a Sunday (weekday 0), 2026-10-12 a Monday.
const at = (date: string, time: string) => wallToInstant(date, time, TZ);
const slot = (date: string, from: string, to: string, toDate = date) => ({
  startsAt: at(date, from),
  endsAt: at(toDate, to),
});
const row = (weekday: number, startsAt: string, endsAt: string): WallShift => ({
  weekday,
  startsAt,
  endsAt,
});
const ids = {
  branchId: "0190f7a2-0000-7000-8000-000000000001",
  providerMembershipId: "0190f7a2-0000-7000-8000-000000000002",
  patientId: "0190f7a2-0000-7000-8000-000000000003",
};

describe("D-5 status transitions", () => {
  const allowed: Record<AppointmentStatus, AppointmentStatus[]> = {
    booked: ["arrived", "no_show", "cancelled"],
    arrived: ["completed", "cancelled"],
    completed: [],
    no_show: [],
    cancelled: [],
  };

  it.each(APPOINTMENT_STATUSES.flatMap((from) => APPOINTMENT_STATUSES.map((to) => [from, to])))(
    "%s → %s follows the table",
    (from, to) => {
      expect(canTransition(from, to)).toBe(allowed[from].includes(to));
    },
  );

  it("only a booked appointment is rescheduled", () => {
    expect(APPOINTMENT_STATUSES.filter(isReschedulable)).toEqual(["booked"]);
  });
});

describe("rule 4 — the end of an appointment", () => {
  const start = at("2026-10-11", "09:00");

  it("keeps the end the client sent", () => {
    expect(resolveAppointmentEnd(start, at("2026-10-11", "09:45"), 30, 20)).toBe(
      at("2026-10-11", "09:45"),
    );
  });

  it("takes the service's duration, else the provider's default", () => {
    expect(resolveAppointmentEnd(start, null, 30, 20)).toBe(at("2026-10-11", "09:30"));
    expect(resolveAppointmentEnd(start, null, null, 20)).toBe(at("2026-10-11", "09:20"));
  });
});

describe("D-15 — 5 minutes to 8 hours", () => {
  const body = (endsAt: string | null) => ({
    ...ids,
    serviceId: null,
    startsAt: at("2026-10-11", "09:00"),
    endsAt,
    overbook: false,
  });

  it("refuses 4 minutes and 8 hours and one minute; accepts both bounds", () => {
    expect(appointmentInputSchema.safeParse(body(at("2026-10-11", "09:04"))).success).toBe(false);
    expect(appointmentInputSchema.safeParse(body(at("2026-10-11", "17:01"))).success).toBe(false);
    expect(appointmentInputSchema.safeParse(body(at("2026-10-11", "09:05"))).success).toBe(true);
    expect(appointmentInputSchema.safeParse(body(at("2026-10-11", "17:00"))).success).toBe(true);
    expect(appointmentInputSchema.safeParse(body(null)).success).toBe(true);
  });

  it("refuses an end before the start on a reschedule", () => {
    const res = appointmentRescheduleSchema.safeParse({
      branchId: ids.branchId,
      providerMembershipId: ids.providerMembershipId,
      startsAt: at("2026-10-11", "09:00"),
      endsAt: at("2026-10-11", "08:00"),
      overbook: false,
    });
    expect(res.success).toBe(false);
  });

  it("D-11: a cancel needs a reason from the list; the note is optional and short", () => {
    expect(appointmentCancelSchema.safeParse({ reason: "other", note: null }).success).toBe(true);
    expect(appointmentCancelSchema.safeParse({ reason: "because", note: null }).success).toBe(
      false,
    );
    expect(
      appointmentCancelSchema.safeParse({ reason: "other", note: "x".repeat(201) }).success,
    ).toBe(false);
  });
});

describe("rule 2 — coverage, time off, overlap (D-6, D-14)", () => {
  const week = [row(0, "08:00", "12:00"), row(0, "16:00", "20:00")];

  it("a slot inside one shift is free", () => {
    expect(appointmentSlotProblems(slot("2026-10-11", "09:00", "09:30"), TZ, week, [], [])).toEqual(
      [],
    );
  });

  it("a slot across the gap of a split shift is outside the schedule", () => {
    expect(appointmentSlotProblems(slot("2026-10-11", "11:45", "16:15"), TZ, week, [], [])).toEqual(
      ["outside_schedule"],
    );
  });

  it("D-14: a shift continued across midnight covers 23:45–00:15", () => {
    const night = [row(0, "20:00", "24:00"), row(1, "00:00", "01:00")];
    const late = slot("2026-10-11", "23:45", "00:15", "2026-10-12");
    expect(appointmentSlotProblems(late, TZ, night, [], [])).toEqual([]);
  });

  it("D-14: a gap at midnight is outside the schedule", () => {
    const gap = [row(0, "20:00", "23:30"), row(1, "00:00", "01:00")];
    const late = slot("2026-10-11", "23:45", "00:15", "2026-10-12");
    expect(appointmentSlotProblems(late, TZ, gap, [], [])).toEqual(["outside_schedule"]);
  });

  it("time off and another appointment are refused; touching ends are not", () => {
    const wanted = slot("2026-10-11", "09:00", "09:30");
    const off = [slot("2026-10-11", "09:15", "10:00")];
    const busy = [slot("2026-10-11", "08:45", "09:05")];
    expect(appointmentSlotProblems(wanted, TZ, week, off, busy)).toEqual([
      "provider_time_off",
      "appointment_overlap",
    ]);
    const before = [slot("2026-10-11", "08:30", "09:00")];
    const after = [slot("2026-10-11", "09:30", "10:00")];
    expect(appointmentSlotProblems(wanted, TZ, week, after, before)).toEqual([]);
  });

  it("reports the three checks in order when all fail", () => {
    const wanted = slot("2026-10-11", "13:00", "13:30");
    expect(appointmentSlotProblems(wanted, TZ, week, [wanted], [wanted])).toEqual([
      "outside_schedule",
      "provider_time_off",
      "appointment_overlap",
    ]);
  });
});

describe("Codex A2 r1", () => {
  it("P2: a fall-back hour never lets a slot leave the shift unchecked (Cairo, 2027-10-28)", () => {
    // Thursday 23:50 → 23:10 on the wall: 20 real minutes that run past 24:00 and back into 23:00.
    const slot = { startsAt: "2027-10-28T20:50:00.000Z", endsAt: "2027-10-28T21:10:00.000Z" };
    const thursdayNight = [row(4, "23:30", "24:00")];
    expect(appointmentSlotProblems(slot, "Africa/Cairo", thursdayNight, [], [])).toEqual([
      "outside_schedule",
    ]);
    const wholeEvening = [row(4, "22:00", "24:00"), row(5, "00:00", "01:00")];
    expect(appointmentSlotProblems(slot, "Africa/Cairo", wholeEvening, [], [])).toEqual([]);
  });

  it("P3: the day query refuses a date that is not on the calendar", () => {
    const branchId = ids.branchId;
    expect(appointmentDayQuerySchema.safeParse({ branchId, date: "2027-99-99" }).success).toBe(
      false,
    );
    expect(appointmentDayQuerySchema.safeParse({ branchId, date: "2027-02-29" }).success).toBe(
      false,
    );
    expect(appointmentDayQuerySchema.safeParse({ branchId, date: "2028-02-29" }).success).toBe(
      true,
    );
  });
});
