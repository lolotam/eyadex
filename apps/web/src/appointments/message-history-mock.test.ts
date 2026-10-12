import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@eyadex/contracts/notifications";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { MOCK_SEND_DELAY_MS } from "@/shared/api/mock/mock-notification-queue";

const admin = () => as("clinic_admin");

function bookedAppointment() {
  const a = getState().appointments.find(
    (x) => x.clinicId === clinicIdAt(0) && x.status === "booked",
  );
  if (!a) throw new Error("no booked appointment");
  return a;
}

beforeEach(() => {
  resetMockData();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("message history (spec §3, §6)", () => {
  it("a cancellation queues a row that is sent through Eyadex when the clinic has no provider", async () => {
    const appt = bookedAppointment();
    const patient = getState().patients.find((p) => p.id === appt.patientId)!;
    patient.email = "someone@example.invalid";
    await api.appointments.cancel(admin(), appt.id, { reason: "other", note: null });
    const queued = await api.notifications.appointmentHistory(admin(), appt.id);
    expect(queued.items.map((i) => [i.kind, i.status])).toEqual([["cancelled", "queued"]]);
    vi.advanceTimersByTime(MOCK_SEND_DELAY_MS);
    const settled = await api.notifications.appointmentHistory(admin(), appt.id);
    expect(settled.items[0]).toMatchObject({ status: "sent", route: "platform" });
  });

  it("a patient with no email is skipped as no_email", async () => {
    const appt = bookedAppointment();
    getState().patients.find((p) => p.id === appt.patientId)!.email = null;
    await api.appointments.cancel(admin(), appt.id, { reason: "other", note: null });
    vi.advanceTimersByTime(MOCK_SEND_DELAY_MS);
    const { items } = await api.notifications.appointmentHistory(admin(), appt.id);
    expect(items[0]).toMatchObject({ status: "skipped", skipReason: "no_email" });
  });

  it("nothing is queued while the message kind is switched off", async () => {
    await api.notifications.updateSettings(admin(), {
      emailEnabled: true,
      messages: { ...DEFAULT_NOTIFICATION_SETTINGS.messages, cancelled: false },
    });
    const appt = bookedAppointment();
    await api.appointments.cancel(admin(), appt.id, { reason: "other", note: null });
    expect((await api.notifications.appointmentHistory(admin(), appt.id)).items).toEqual([]);
  });

  it("NEGATIVE: another clinic's appointment is not_found", async () => {
    const appt = bookedAppointment();
    await expect(
      api.notifications.appointmentHistory(as("clinic_admin", 1), appt.id),
    ).rejects.toMatchObject({ code: expect.stringMatching(/not_found|module_disabled/) });
  });
});
