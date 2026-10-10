import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentDay } from "@eyadex/contracts/appointments";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaContext } from "@/shared/persona/persona-context";
import { BookingDialog, type BookingRequest } from "./booking-dialog";
import { DayView } from "./day-view";

// The real mock client, with the create call recorded instead of run: this test is about the request.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/shared/api/api-provider", async () => {
  const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
  const client = createMockApiClient();
  const recorded = { ...client, appointments: { ...client.appointments, create } };
  return {
    ApiProvider: ({ children }: { children: ReactNode }) => children,
    useApi: () => recorded,
  };
});

// Codex PR #64: London falls back on 2027-10-31, so the wall time 01:30 is two slots (00:30Z, 01:30Z).
const LONDON = "Europe/London";
const FALL_BACK = "2027-10-31";
const persona = as("clinic_admin");

beforeEach(() => {
  resetMockData();
  create.mockReset();
  create.mockResolvedValue({});
});
afterEach(() => cleanup());

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <PersonaContext.Provider value={{ persona, ready: true, setPersona: () => undefined }}>
          {node}
        </PersonaContext.Provider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

async function fallBackDay(minutes: number): Promise<AppointmentDay> {
  const doctor = getState().members.find(
    (m) => m.clinicId === clinicIdAt(0) && m.status === "active" && m.branchIds.length > 0,
  )!;
  const day = await api.appointments.day(persona, {
    branchId: doctor.branchIds[0]!,
    date: "2027-03-07",
  });
  const provider = day.providers.find((p) => p.bookable)!;
  return {
    ...day,
    date: FALL_BACK,
    timezone: LONDON,
    providers: [
      {
        ...provider,
        defaultDurationMinutes: minutes,
        shifts: [{ startsAt: "00:00", endsAt: "04:00" }],
        timeOff: [],
      },
    ],
    appointments: [],
  };
}

/** Clicks the nth slot labelled 01:30, then books it untouched through the dialog. */
async function bookSlot(nth: number, minutes = 20) {
  const day = await fallBackDay(minutes);
  const provider = day.providers[0]!;
  const onBook = vi.fn();
  const grid = wrap(
    <DayView day={day} onBook={onBook} onReschedule={vi.fn()} onCancel={vi.fn()} />,
  );
  const label = ar.appointments.bookAt
    .replace("{provider}", provider.fullName)
    .replace("{time}", "01:30");
  const slots = screen.getAllByRole("button", { name: label });
  expect(slots).toHaveLength(2);
  fireEvent.click(slots[nth]!);
  const [providerId, startsAt] = onBook.mock.calls[0] as [string, string];
  grid.unmount();

  const request: BookingRequest = { kind: "create", providerId, startsAt };
  wrap(<BookingDialog request={request} day={day} onClose={vi.fn()} />);
  const start = await screen.findByLabelText<HTMLInputElement>(ar.appointments.dialog.start);
  expect(start.value).toBe("01:30");
  const end = screen.getByLabelText<HTMLInputElement>(ar.appointments.dialog.end).value;
  const patient = getState().patients.find(
    (p) => p.clinicId === clinicIdAt(0) && p.status === "active",
  )!;
  fireEvent.change(await screen.findByLabelText(ar.appointments.patientPicker.search), {
    target: { value: patient.fullName },
  });
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(patient.fullName) }));
  fireEvent.click(screen.getByRole("button", { name: ar.appointments.dialog.save }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  return { input: create.mock.calls[0]![1] as { startsAt: string; endsAt: string }, end };
}

const plus = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

describe("Codex PR #64: a slot inside the repeated hour books its own instant", () => {
  it("the first 01:30 books 00:30Z, its end on the same reading", async () => {
    const { input } = await bookSlot(0);
    expect(input.startsAt).toBe("2027-10-31T00:30:00.000Z");
    expect(input.endsAt).toBe(plus(input.startsAt, 20));
  });

  it("the second 01:30 books 01:30Z, an hour later than the first", async () => {
    const { input } = await bookSlot(1);
    expect(input.startsAt).toBe("2027-10-31T01:30:00.000Z");
    expect(input.endsAt).toBe(plus(input.startsAt, 20));
  });

  it("a length that crosses the clock change keeps its real minutes (Codex gh1fix)", async () => {
    // 40 minutes after the first 01:30 is 01:10 on the fallen-back clock, not 02:10.
    const { input, end } = await bookSlot(0, 40);
    expect(end).toBe("01:10");
    expect(input.startsAt).toBe("2027-10-31T00:30:00.000Z");
    expect(input.endsAt).toBe("2027-10-31T01:10:00.000Z");
  });
});
