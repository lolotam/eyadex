import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getState, resetMockData } from "./mock-test-kit";
import { queueNotification } from "./mock-notification-queue";
import { notificationState } from "./mock-notification-state";

beforeEach(() => {
  vi.useFakeTimers();
  resetMockData();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("notification queue unique delivery parity", () => {
  it("A → B → A → B rescheduling keeps one row and one timer per delivery key", () => {
    const db = getState();
    const appointment = db.appointments[0]!;
    const subject = {
      clinicId: appointment.clinicId,
      patientId: appointment.patientId,
      kind: "rescheduled" as const,
      subjectType: "appointment" as const,
      subjectId: appointment.id,
      subjectAt: appointment.startsAt,
    };
    const a = appointment.startsAt;
    const b = new Date(Date.parse(a) + 3_600_000).toISOString();
    const timerCount = vi.getTimerCount();
    for (const subjectAt of [a, b, a, b]) queueNotification(db, { ...subject, subjectAt });
    expect(notificationState(db).ledger.map((row) => row.subjectAt)).toEqual([a, b]);
    expect(vi.getTimerCount() - timerCount).toBe(2);
  });

  it("the unique delivery key treats null subjectAt as equal", () => {
    const db = getState();
    const appointment = db.appointments[0]!;
    const subject = {
      clinicId: appointment.clinicId,
      patientId: appointment.patientId,
      kind: "prescription" as const,
      subjectType: "visit" as const,
      subjectId: "visit-fixture",
      subjectAt: null,
    };
    const timerCount = vi.getTimerCount();
    queueNotification(db, subject);
    queueNotification(db, subject);
    expect(notificationState(db).ledger).toHaveLength(1);
    expect(vi.getTimerCount() - timerCount).toBe(1);
    queueNotification(db, { ...subject, subjectId: "second-visit-fixture" });
    queueNotification(db, { ...subject, clinicId: db.clinics[1]!.id });
    expect(notificationState(db).ledger).toHaveLength(3);
  });
});
