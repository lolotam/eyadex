import { describe, expect, it } from "vitest";

import { auditSnapshots } from "../../../audit/domain/audit-snapshot.ts";
import {
  appointmentAuditSnapshot,
  appointmentReach,
  decideSlot,
  decideTransition,
} from "../booking-rules.ts";

// D-3, D-5, rule 9 (spec §4), ADR-0026 §11.
const member = { all: false as const, branchIds: ["b1"] };

describe("appointmentReach", () => {
  it("clinic key = every branch, branch key = the member's, none = nothing", () => {
    expect(appointmentReach(["create:appointments:clinic"], "create", member)).toEqual({
      all: true,
    });
    expect(appointmentReach(["create:appointments:branch"], "create", member)).toEqual(member);
    expect(appointmentReach(["view:appointments:own"], "view", member)).toEqual({
      all: false,
      branchIds: [],
    });
    expect(appointmentReach(["create:appointments:clinic"], "overbook", member)).toEqual({
      all: false,
      branchIds: [],
    });
  });
});

describe("decideSlot — overbook lifts rule 2's checks only", () => {
  it("a free slot is booked, not overbooked", () => {
    expect(decideSlot([], false)).toEqual({ kind: "ok", overbooked: false });
    expect(decideSlot([], true)).toEqual({ kind: "ok", overbooked: false });
  });

  it("without overbook the first problem is the answer", () => {
    expect(decideSlot(["provider_time_off", "appointment_overlap"], false)).toEqual({
      kind: "refused",
      code: "provider_time_off",
    });
  });

  it("with overbook every problem is lifted and the booking is marked", () => {
    expect(decideSlot(["outside_schedule", "appointment_overlap"], true)).toEqual({
      kind: "ok",
      overbooked: true,
    });
  });
});

describe("decideTransition (D-5)", () => {
  it("same status is no change; the table decides the rest", () => {
    expect(decideTransition("arrived", "arrived")).toBe("same");
    expect(decideTransition("booked", "arrived")).toBe("move");
    expect(decideTransition("arrived", "completed")).toBe("move");
    expect(decideTransition("completed", "arrived")).toBe("invalid");
    expect(decideTransition("arrived", "no_show")).toBe("invalid");
    expect(decideTransition("cancelled", "booked")).toBe("invalid");
  });
});

describe("the appointment audit snapshot (rule 9)", () => {
  const snapshot = appointmentAuditSnapshot({
    providerName: "Dr. Huda",
    branchId: "b1",
    serviceNameAr: "ليزر",
    serviceNameEn: "Laser",
    startsAt: "2026-10-11T06:00:00.000Z",
    endsAt: "2026-10-11T06:30:00.000Z",
    status: "cancelled",
    overbooked: true,
    cancelReason: "other",
  });

  it("records the booking's administrative facts, never the patient or the note", () => {
    expect(Object.keys(snapshot).sort()).toEqual([
      "branchId",
      "cancelReason",
      "endsAt",
      "overbooked",
      "providerName",
      "serviceNameAr",
      "serviceNameEn",
      "startsAt",
      "status",
    ]);
  });

  it("the reader shows only the allowlist, whatever a writer stored", () => {
    const shown = auditSnapshots("appointment", {
      before: null,
      after: { ...snapshot, patientName: "x", patientId: "p", phone: "+96500000001", note: "n" },
    });
    expect(shown.after).toEqual(snapshot);
  });
});
