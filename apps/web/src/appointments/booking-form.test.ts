import { describe, expect, it } from "vitest";
import { wallToInstant } from "@eyadex/contracts/clinic-time";
import { ApiError } from "@/shared/api/api-error";
import {
  endFor,
  formOf,
  skippedTimeField,
  slotRefusal,
  toAppointmentInput,
  toRescheduleInput,
  type BookingForm,
} from "./booking-form";

const TZ = "Asia/Kuwait";
const values: BookingForm = {
  patientId: "p",
  providerMembershipId: "m",
  serviceId: "none",
  date: "2027-03-07",
  startTime: "23:45",
  endTime: "00:15",
  overbook: false,
};

describe("the booking form", () => {
  it("pre-fills the end from a length, wrapping at midnight", () => {
    expect(endFor("09:00", 20)).toBe("09:20");
    expect(endFor("23:50", 20)).toBe("00:10");
  });

  it("turns wall times into instants; an end before the start is the next day", () => {
    const input = toAppointmentInput(values, "b", TZ);
    expect(input).toMatchObject({
      branchId: "b",
      serviceId: null,
      startsAt: wallToInstant("2027-03-07", "23:45", TZ),
      endsAt: wallToInstant("2027-03-08", "00:15", TZ),
      overbook: false,
    });
    expect(toRescheduleInput({ ...values, endTime: "23:55" }, "b", TZ)).not.toHaveProperty(
      "patientId",
    );
  });

  it("explains only rule 2's refusals beside the time", () => {
    expect(slotRefusal(new ApiError("appointment_overlap"))).toBe("appointment_overlap");
    expect(slotRefusal(new ApiError("forbidden"))).toBeNull();
  });
});

describe("Codex A2 r1", () => {
  it("P2: moving an overbooked appointment does not ask for overbook again", () => {
    const appointment = {
      id: "a",
      branchId: "b",
      providerMembershipId: "m",
      providerName: "Dr",
      patientId: "p",
      patientName: "P",
      patientFileNumber: 1,
      serviceId: null,
      serviceNameAr: null,
      serviceNameEn: null,
      startsAt: wallToInstant("2027-03-07", "09:00", TZ),
      endsAt: wallToInstant("2027-03-07", "09:20", TZ),
      status: "booked" as const,
      overbooked: true,
      cancelReason: null,
      cancelNote: null,
    };
    expect(formOf(appointment, TZ).overbook).toBe(false);
  });

  it("P2: names a start or end the clinic's clock skips (Cairo, 2027-04-30 00:00–01:00)", () => {
    const cairo = { ...values, date: "2027-04-30", startTime: "00:30", endTime: "02:00" };
    expect(skippedTimeField(cairo, "Africa/Cairo")).toBe("startTime");
    expect(skippedTimeField({ ...cairo, startTime: "01:30" }, "Africa/Cairo")).toBeNull();
    const late = { ...values, date: "2027-04-29", startTime: "23:50", endTime: "00:20" };
    expect(skippedTimeField(late, "Africa/Cairo")).toBe("endTime");
  });
});

describe("Codex A2 r3", () => {
  it("P2: moving a visit through the repeated hour without touching its times keeps its instants", () => {
    const CAIRO = "Africa/Cairo";
    const original = {
      id: "a",
      branchId: "b",
      providerMembershipId: "m",
      providerName: "Dr",
      patientId: "p",
      patientName: "P",
      patientFileNumber: 1,
      serviceId: null,
      serviceNameAr: null,
      serviceNameEn: null,
      startsAt: "2027-10-28T20:50:00.000Z",
      endsAt: "2027-10-28T21:10:00.000Z",
      status: "booked" as const,
      overbooked: false,
      cancelReason: null,
      cancelNote: null,
    };
    const form = formOf(original, CAIRO);
    const moved = toRescheduleInput({ ...form, providerMembershipId: "m2" }, "b", CAIRO, original);
    expect(moved).toMatchObject({
      startsAt: original.startsAt,
      endsAt: original.endsAt,
      providerMembershipId: "m2",
    });
  });
});

describe("Codex PR #64", () => {
  it("P2: a start edited away from the clicked slot is read as typed", () => {
    const LONDON = "Europe/London";
    const slot = "2027-10-31T00:30:00.000Z"; // the first 01:30 of the fall-back day
    const form = { ...values, date: "2027-10-31", startTime: "02:30", endTime: "02:50" };
    expect(toAppointmentInput(form, "b", LONDON, slot)).toMatchObject({
      startsAt: wallToInstant("2027-10-31", "02:30", LONDON),
      endsAt: wallToInstant("2027-10-31", "02:50", LONDON),
    });
  });
});
