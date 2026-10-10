import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { ApiProvider } from "@/shared/api/api-provider";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaContext } from "@/shared/persona/persona-context";
import { BookingDialog } from "./booking-dialog";
import { DayView } from "./day-view";

// Spec §5: the branch day and the booking dialog show only what the caller may do (UX; the API refuses too).
const SUNDAY = "2027-03-07";

beforeEach(() => resetMockData());
afterEach(() => cleanup());

function wrap(persona: Persona, node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ApiProvider>
          <PersonaContext.Provider value={{ persona, ready: true, setPersona: () => undefined }}>
            {node}
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
const noop = () => undefined;

async function dayFor(persona: Persona) {
  const d = doctor();
  const patient = getState().patients.find(
    (p) => p.clinicId === clinicIdAt(0) && p.status === "active",
  )!;
  await api.appointments.create(
    as("clinic_admin"),
    {
      branchId: d.branchIds[0]!,
      providerMembershipId: d.id,
      patientId: patient.id,
      serviceId: null,
      startsAt: "2027-03-07T07:00:00.000Z",
      endsAt: null,
      overbook: false,
    },
    crypto.randomUUID(),
  );
  return {
    day: await api.appointments.day(persona, { branchId: d.branchIds[0]!, date: SUNDAY }),
    d,
    patient,
  };
}

describe("the branch day", () => {
  it("offers a slot per half hour and the block's actions to a booker", async () => {
    const persona = as("clinic_admin");
    const { day, d, patient } = await dayFor(persona);
    wrap(persona, <DayView day={day} onBook={noop} onReschedule={noop} onCancel={noop} />);
    const label = ar.appointments.bookAt
      .replace("{provider}", d.fullName)
      .replace("{time}", "09:00");
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    expect(screen.getByText(patient.fullName)).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: ar.appointments.actions.menu }).length,
    ).toBeGreaterThan(0);
  });

  it("hides every write when the caller can only view", async () => {
    const persona = as("clinic_admin");
    const { day } = await dayFor(persona);
    const readOnly = { ...day, can: { create: false, update: false, overbook: false } };
    wrap(persona, <DayView day={readOnly} onBook={noop} onReschedule={noop} onCancel={noop} />);
    expect(screen.queryAllByRole("button", { name: /احجز مع/ })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: ar.appointments.actions.menu })).toHaveLength(0);
  });
});

describe("the booking dialog", () => {
  it("shows the overbook switch only when the day says the caller holds it", async () => {
    const persona = as("clinic_admin");
    const { day, d } = await dayFor(persona);
    const request = { kind: "create" as const, providerId: d.id, date: SUNDAY, startTime: "10:00" };
    const view = wrap(persona, <BookingDialog request={request} day={day} onClose={noop} />);
    await waitFor(() =>
      expect(screen.getByText(ar.appointments.dialog.overbook)).toBeInTheDocument(),
    );
    view.unmount();
    const without = { ...day, can: { ...day.can, overbook: false } };
    wrap(persona, <BookingDialog request={request} day={without} onClose={noop} />);
    await waitFor(() =>
      expect(screen.getByText(ar.appointments.dialog.createTitle)).toBeInTheDocument(),
    );
    expect(screen.queryByText(ar.appointments.dialog.overbook)).toBeNull();
  });

  it("Codex A2 r1: a refetched day keeps what the user typed", async () => {
    const persona = as("clinic_admin");
    const { day, d } = await dayFor(persona);
    const request = { kind: "create" as const, providerId: d.id, date: SUNDAY, startTime: "10:00" };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (current: typeof day) => (
      <QueryClientProvider client={client}>
        <I18nProvider>
          <ApiProvider>
            <PersonaContext.Provider value={{ persona, ready: true, setPersona: () => undefined }}>
              <BookingDialog request={request} day={current} onClose={noop} />
            </PersonaContext.Provider>
          </ApiProvider>
        </I18nProvider>
      </QueryClientProvider>
    );
    const view = render(tree(day));
    const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
    const start = await screen.findByLabelText(ar.appointments.dialog.start);
    fireEvent.change(start, { target: { value: "11:30" } });
    // Changing the start pre-fills the end from the provider's default length (rule 4).
    await waitFor(() => expect(field(ar.appointments.dialog.end).value).toBe("11:50"));
    fireEvent.change(field(ar.appointments.dialog.end), { target: { value: "12:15" } });
    // Codex A2 r2: a refetch brings new provider objects; the end typed by hand stays.
    view.rerender(
      tree({
        ...day,
        providers: day.providers.map((p) => ({ ...p })),
        appointments: [...day.appointments],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(field(ar.appointments.dialog.start).value).toBe("11:30");
    expect(field(ar.appointments.dialog.end).value).toBe("12:15");
  });
});
