import { describe, expect, it } from "vitest";

import { appointmentNotice } from "../appointment-notices.ts";

const CLINIC = "0190a000-0000-7000-8000-0000000000c0";
const MEMBER = "0190a000-0000-7000-8000-0000000000c1";
const actor = { clinicId: CLINIC, membershipId: MEMBER };
const appointment = {
  id: "0190a000-0000-7000-8000-0000000000a1",
  patientId: "0190a000-0000-7000-8000-0000000000b1",
  startsAt: "2027-03-07T07:00:00.000Z",
};

describe("appointmentNotice (spec §3.1)", () => {
  it.each(["booked", "rescheduled", "cancelled"] as const)(
    "%s names the appointment, its patient, the start given and the acting membership",
    (kind) => {
      expect(appointmentNotice(kind, appointment, actor)).toEqual({
        clinicId: CLINIC,
        kind,
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        startsAt: appointment.startsAt,
        requestedBy: MEMBER,
      });
    },
  );
});
