import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentDay } from "@eyadex/contracts/appointments";
import type { Persona } from "@eyadex/contracts/session";
import { ApiProvider } from "@/shared/api/api-provider";
import { api, as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaContext } from "@/shared/persona/persona-context";
import { AppointmentsContent } from "./appointments-content";
import { QueueView } from "./queue-view";

// Slice A4 screens: the switcher writes `view=` to the URL, the month opens a day, the queue's moves
// follow the transitions table and need `can.update`, the own doctor's week has no provider picker.
const router = vi.hoisted(() => ({ search: {} as Record<string, unknown>, navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/clinic">{children}</a>,
  useSearch: () => router.search,
  useNavigate: () => router.navigate,
}));

beforeEach(() => {
  resetMockData();
  router.search = {};
  router.navigate.mockReset();
});
afterEach(() => cleanup());

async function renderAs(persona: Persona, view: string, permissions?: string[]) {
  router.search = { view };
  const context = await api.session.getContext(persona);
  const session = permissions ? { ...context, permissions } : context;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const http = { session, isLoading: false, error: null, area: "clinic" as const, retry: vi.fn() };
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ApiProvider>
          <PersonaContext.Provider value={{ persona, ready: true, setPersona: vi.fn(), http }}>
            <AppointmentsContent />
          </PersonaContext.Provider>
        </ApiProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("the view switcher", () => {
  it("writes the chosen view to the URL", async () => {
    await renderAs(as("clinic_admin"), "day");
    const tab = await screen.findByRole("tab", { name: ar.appointments.views.week });
    fireEvent.mouseDown(tab, { button: 0 });
    expect(router.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { view: "week" } }),
    );
  });

  it("a month day opens the Day view on that date", async () => {
    await renderAs(as("clinic_admin"), "month");
    const day = await screen.findByRole("button", { name: /^اليوم 15:/ });
    fireEvent.click(day);
    expect(router.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { view: "day" } }),
    );
  });
});

describe("the provider week picker", () => {
  it("is offered above own and absent for the own-only doctor", async () => {
    await renderAs(as("clinic_admin"), "week");
    expect(
      await screen.findByRole("combobox", { name: ar.appointments.provider }),
    ).toBeInTheDocument();
    cleanup();
    await renderAs(as("doctor"), "week", ["view:appointments:own"]);
    await screen.findByRole("tab", { name: ar.appointments.views.week });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: ar.appointments.week.next })).not.toBeNull(),
    );
    expect(screen.queryByRole("combobox", { name: ar.appointments.provider })).toBeNull();
  });
});

function queueDay(update: boolean): AppointmentDay {
  const base = {
    branchId: "0190a000-0000-7000-8000-000000000001",
    providerMembershipId: "0190a000-0000-7000-8000-000000000002",
    providerName: "Provider A",
    patientId: "0190a000-0000-7000-8000-000000000003",
    patientFileNumber: 7,
    serviceId: null,
    serviceNameAr: null,
    serviceNameEn: null,
    overbooked: false,
    cancelReason: null,
    cancelNote: null,
  };
  return {
    branch: { id: base.branchId, nameAr: "ف", nameEn: "B", isActive: true },
    date: "2027-03-07",
    timezone: "Asia/Kuwait",
    providers: [],
    appointments: [
      {
        ...base,
        id: "0190a000-0000-7000-8000-00000000000b",
        patientName: "Later Arrived",
        startsAt: "2027-03-07T08:00:00.000Z",
        endsAt: "2027-03-07T08:20:00.000Z",
        status: "arrived",
      },
      {
        ...base,
        id: "0190a000-0000-7000-8000-00000000000a",
        patientName: "Early Booked",
        startsAt: "2027-03-07T06:00:00.000Z",
        endsAt: "2027-03-07T06:20:00.000Z",
        status: "booked",
      },
    ],
    can: { create: false, update, overbook: false },
  };
}

function wrapQueue(day: AppointmentDay) {
  const client = new QueryClient();
  const persona = as("clinic_admin");
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ApiProvider>
          <PersonaContext.Provider value={{ persona, ready: true, setPersona: vi.fn() }}>
            <QueueView day={day} onCancel={vi.fn()} />
          </PersonaContext.Provider>
        </ApiProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const menuItems = (row: HTMLElement) => {
  const trigger = within(row).getByRole("button", { name: ar.appointments.actions.menu });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getAllByRole("menuitem").map((item) => item.textContent);
};

describe("today's queue", () => {
  it("lists by start time and hides every action without can.update", () => {
    wrapQueue(queueDay(false));
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Early Booked");
    expect(rows[1]).toHaveTextContent("Later Arrived");
    expect(screen.queryAllByRole("button", { name: ar.appointments.actions.menu })).toHaveLength(0);
  });

  it("offers booked → arrived, no-show, cancel and arrived → completed, cancel", () => {
    wrapQueue(queueDay(true));
    const a = ar.appointments.actions;
    const [booked, arrived] = screen.getAllByRole("listitem");
    expect(menuItems(booked!)).toEqual([a.arrived, a.no_show, ar.messageHistory.title, a.cancel]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    cleanup();
    wrapQueue(queueDay(true));
    expect(menuItems(screen.getAllByRole("listitem")[1]!)).toEqual([a.completed, ar.messageHistory.title, a.cancel]);
  });
});
