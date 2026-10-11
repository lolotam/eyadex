import type { ReactNode } from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Appointment } from "@eyadex/contracts/appointments";
import type { Persona } from "@eyadex/contracts/session";
import { as, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { renderAs } from "@/shared/persona/persona-test-kit";
import { StartVisitButton } from "./start-visit-button";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));

beforeEach(() => resetMockData());
afterEach(() => cleanup());

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
const appointment = (providerMembershipId: string, status: Appointment["status"]) =>
  ({ id: crypto.randomUUID(), providerMembershipId, status }) as Appointment;
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
