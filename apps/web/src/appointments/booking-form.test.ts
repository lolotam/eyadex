import { describe, expect, it } from "vitest";
import { wallToInstant } from "@eyadex/contracts/clinic-time";
import { ApiError } from "@/shared/api/api-error";
import {
  endFor,
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
