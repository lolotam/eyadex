import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wallToInstant } from "@eyadex/contracts/clinic-time";
import { ApiProvider } from "@/shared/api/api-provider";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaContext } from "@/shared/persona/persona-context";
import { PatientsContent } from "./patients-content";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/clinic">{children}</a>,
  useNavigate: () => vi.fn(),
}));

// ADR-0026 A3 (spec §5): an own-only doctor sees its own files, and an empty list says why.
beforeEach(() => {
  resetMockData();
  getState().appointments = getState().appointments.filter((a) => a.clinicId !== clinicIdAt(0));
  // The demo's seeded visits make files the doctor's own too (R1-18).
  getState().medical.visits = getState().medical.visits.filter((v) => v.clinicId !== clinicIdAt(0));
});
afterEach(() => cleanup());

async function renderPatients() {
  const persona = as("doctor");
  const session = await api.session.getContext(persona);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const http = { session, isLoading: false, error: null, area: "clinic" as const, retry: vi.fn() };
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ApiProvider>
          <PersonaContext.Provider value={{ persona, ready: true, setPersona: vi.fn(), http }}>
            <PatientsContent />
          </PersonaContext.Provider>
        </ApiProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const doctor = () => {
  const role = getState().roles.find(
    (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "doctor",
  )!;
  return getState().members.find((m) => m.roleId === role.id && m.status === "active")!;
};

describe("the patients list of an own-only doctor", () => {
  it("says the doctor has no patients yet when no file has a booking with it", async () => {
    await renderPatients();
    expect(await screen.findByText(ar.patients.emptyOwn)).toBeInTheDocument();
    expect(screen.queryByText(ar.patients.empty)).toBeNull();
  });

  it("shows only the doctor's own files", async () => {
    const [mine, theirs] = getState().patients.filter((p) => p.clinicId === clinicIdAt(0));
    const at = wallToInstant("2027-03-07", "09:00", getState().clinics[0]!.timezone);
    getState().appointments.push({
      id: crypto.randomUUID(),
      clinicId: clinicIdAt(0),
      branchId: doctor().branchIds[0]!,
      patientId: mine!.id,
      providerMembershipId: doctor().id,
      serviceId: null,
      startsAt: at,
      endsAt: at,
      status: "booked",
      overbooked: false,
      cancelReason: null,
      cancelNote: null,
      createdAt: at,
    });
    await renderPatients();
    expect(await screen.findByText(mine!.fullName)).toBeInTheDocument();
    expect(screen.queryByText(theirs!.fullName)).toBeNull();
  });
});
