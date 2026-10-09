import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiProvider } from "@/shared/api/api-provider";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaContext } from "@/shared/persona/persona-context";
import { DormantHoursPanel } from "./dormant-hours-panel";

beforeEach(() => resetMockData());
afterEach(() => cleanup());

const doctorWithLeftRows = () => {
  const d = getState().members.find((m) => {
    const role = getState().roles.find((r) => r.id === m.roleId);
    return m.clinicId === clinicIdAt(0) && m.status === "active" && role?.systemKey === "doctor";
  })!;
  const left = getState().branches.find(
    (b) => b.clinicId === clinicIdAt(0) && !d.branchIds.includes(b.id),
  )!;
  getState().scheduleRows.push({
    id: crypto.randomUUID(),
    clinicId: clinicIdAt(0),
    membershipId: d.id,
    branchId: left.id,
    weekday: 2,
    startsAt: "08:00",
    endsAt: "12:00",
  });
  return { d, left };
};

// Codex PR #63 P2: dormant rows block overlapping hours, so the tab lists them and lets them be cleared.
describe("dormant hours panel", () => {
  it("lists a dormant branch's rows and removes them with an empty week", async () => {
    const { d, left } = doctorWithLeftRows();
    const persona = as("clinic_admin");
    const schedule = await api.scheduling.getProviderSchedule(persona, d.id);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <ApiProvider>
            <PersonaContext.Provider value={{ persona, ready: true, setPersona: () => undefined }}>
              <DormantHoursPanel schedule={schedule} mayEdit />
            </PersonaContext.Provider>
          </ApiProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(left.nameAr)).toBeInTheDocument();
    expect(screen.getByText(ar.schedules.dormant.left)).toBeInTheDocument();
    expect(screen.getByText("08:00–12:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ar.schedules.dormant.clear }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: ar.schedules.dormant.clear }));
    await waitFor(() =>
      expect(
        getState().scheduleRows.some((r) => r.membershipId === d.id && r.branchId === left.id),
      ).toBe(false),
    );
  });

  it("shows no remove action without the update key, and nothing when no branch is dormant", async () => {
    const { d } = doctorWithLeftRows();
    const persona = as("clinic_admin");
    const schedule = await api.scheduling.getProviderSchedule(persona, d.id);
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <ApiProvider>
            <PersonaContext.Provider value={{ persona, ready: true, setPersona: () => undefined }}>
              <DormantHoursPanel schedule={schedule} mayEdit={false} />
            </PersonaContext.Provider>
          </ApiProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(ar.schedules.dormant.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ar.schedules.dormant.clear })).toBeNull();
    view.rerender(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <ApiProvider>
            <PersonaContext.Provider value={{ persona, ready: true, setPersona: () => undefined }}>
              <DormantHoursPanel schedule={{ ...schedule, dormantBranches: [] }} mayEdit />
            </PersonaContext.Provider>
          </ApiProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByText(ar.schedules.dormant.title)).toBeNull();
  });
});
