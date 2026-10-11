import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Appointment } from "@eyadex/contracts/appointments";
import type { Persona } from "@eyadex/contracts/session";
import { api, as, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { renderAs } from "@/shared/persona/persona-test-kit";
import { StartVisitButton } from "./start-visit-button";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => navigate,
}));

beforeEach(() => {
  resetMockData();
  navigate.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The first clinic's active doctors (demo data, not an access rule).
function doctorMember(index: number) {
  const db = getState();
  const clinicId = db.clinics[0]!.id;
  const doctorRoles = new Set(
    db.roles.filter((r) => r.clinicId === clinicId && r.systemKey === "doctor").map((r) => r.id),
  );
  const doctors = db.members.filter(
    (m) => m.clinicId === clinicId && m.status === "active" && doctorRoles.has(m.roleId),
  );
  return doctors[index]!;
}
const doctorAt = (index: number): Persona => ({
  kind: "doctor",
  clinicId: getState().clinics[0]!.id,
  memberId: doctorMember(index).id,
});
const appointment = (
  providerMembershipId: string,
  status: Appointment["status"],
  id: string = crypto.randomUUID(),
) => ({ id, providerMembershipId, status }) as Appointment;
const shown = () => screen.queryByRole("button", { name: new RegExp(ar.visits.start) }) !== null;

// Owner decision 2026-10-10: arrived + the session's membership is the provider + create:visits:own.
describe("the Start visit button", () => {
  it("shows to the provider, whatever their appointments view", async () => {
    const keys = ["create:visits:own", "view:appointments:clinic"];
    await renderAs(
      doctorAt(0),
      <StartVisitButton appointment={appointment(doctorMember(0).id, "arrived")} />,
      keys,
    );
    expect(shown()).toBe(true);
  });

  it("hides for another provider's appointment, before arrival, or without the key", async () => {
    const mine = doctorMember(0).id;
    const cases: [string, Appointment["status"], string[]][] = [
      [doctorMember(1).id, "arrived", ["create:visits:own"]],
      [mine, "booked", ["create:visits:own"]],
      [mine, "arrived", ["view:visits:own"]],
    ];
    for (const [provider, status, keys] of cases) {
      await renderAs(
        doctorAt(0),
        <StartVisitButton appointment={appointment(provider, status)} />,
        keys,
      );
      expect(shown()).toBe(false);
      cleanup();
    }
    await renderAs(
      as("clinic_admin"),
      <StartVisitButton appointment={appointment(mine, "arrived")} />,
      ["create:visits:own"],
    );
    expect(shown()).toBe(false);
  });
});

/** The first doctor's live appointment, set to arrived (demo data, not an access rule). */
function arrivedAppointment() {
  const appt = getState().appointments.find(
    (a) => a.providerMembershipId === doctorMember(0).id && a.status !== "cancelled",
  )!;
  appt.status = "arrived";
  return appointment(appt.providerMembershipId, "arrived", appt.id);
}
const press = () =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp(ar.visits.start) }));

// Codex 4241453967: the visit page needs a view:visits key, so only such a role is taken there.
describe("after Start visit", () => {
  it("opens the started visit for a role that views visits", async () => {
    const appt = arrivedAppointment();
    await renderAs(doctorAt(0), <StartVisitButton appointment={appt} />, [
      "create:visits:own",
      "view:visits:own",
    ]);
    press();
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const started = getState().medical.visits.find((v) => v.appointmentId === appt.id)!;
    expect(navigate.mock.calls[0]![0]).toMatchObject({ params: { visitId: started.id } });
  });

  it("starts but stays, with a toast, for a role that cannot view visits", async () => {
    const appt = arrivedAppointment();
    const success = vi.spyOn(toast, "success");
    await renderAs(doctorAt(0), <StartVisitButton appointment={appt} />, ["create:visits:own"]);
    press();
    await waitFor(() => expect(success).toHaveBeenCalledWith(ar.visits.startedNoView));
    expect(navigate).not.toHaveBeenCalled();
    expect(getState().medical.visits.filter((v) => v.appointmentId === appt.id)).toHaveLength(1);
  });

  it("names the existing visit instead of opening it for a role that cannot view visits", async () => {
    const appt = arrivedAppointment();
    await api.medical.startVisit(doctorAt(0), { appointmentId: appt.id }, crypto.randomUUID());
    const error = vi.spyOn(toast, "error");
    await renderAs(doctorAt(0), <StartVisitButton appointment={appt} />, ["create:visits:own"]);
    press();
    await waitFor(() => expect(error).toHaveBeenCalledWith(ar.errors.visit_exists));
    expect(navigate).not.toHaveBeenCalled();
  });
});
