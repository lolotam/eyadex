import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiProvider } from "@/shared/api/api-provider";
import { as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaContext } from "@/shared/persona/persona-context";
import { SchedulesContent } from "./schedules-content";

beforeEach(() => resetMockData());
afterEach(() => cleanup());

const renderAsDesk = () => {
  const persona = as("receptionist");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ApiProvider>
          <PersonaContext.Provider value={{ persona, ready: true, setPersona: () => undefined }}>
            <SchedulesContent />
          </PersonaContext.Provider>
        </ApiProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
};

// The only provider a branch-scope desk sees is one holding rows left in the desk's branch.
const deskSeesOnlyLeftRows = () => {
  const state = getState();
  const receptionist = state.roles.find(
    (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist",
  )!;
  receptionist.permissions.push("view:schedules:branch", "update:schedules:branch");
  const desk = state.members.find(
    (m) => m.clinicId === clinicIdAt(0) && m.roleId === receptionist.id && m.status === "active",
  )!;
  const other = state.members.find(
    (m) =>
      m.clinicId === clinicIdAt(0) &&
      m.status === "active" &&
      !m.allBranches &&
      !m.branchIds.some((id) => desk.branchIds.includes(id)),
  )!;
  for (const m of state.members) {
    const accepts = m.id === other.id;
    state.bookingProfiles[m.id] = { acceptsAppointments: accepts, defaultDurationMinutes: 20 };
  }
  state.scheduleRows.push({
    id: crypto.randomUUID(),
    clinicId: clinicIdAt(0),
    membershipId: other.id,
    branchId: desk.branchIds[0]!,
    weekday: 2,
    startsAt: "08:00",
    endsAt: "12:00",
  });
};

// Codex r1 on the dormant-visibility fix: clearing the last left row drops the provider from the list.
describe("schedules tab", () => {
  it("leaves a provider seen only through cleared rows instead of sticking on not_found", async () => {
    deskSeesOnlyLeftRows();
    renderAsDesk();
    fireEvent.click(await screen.findByRole("button", { name: ar.schedules.dormant.clear }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: ar.schedules.dormant.clear }));
    await waitFor(() => {
      expect(screen.getByText(ar.schedules.noProviders)).toBeInTheDocument();
      expect(screen.queryByText(ar.schedules.loadError)).toBeNull();
    });
  });

  // Codex PR #63: view:schedules:clinic shows every branch, update:schedules:branch edits only the desk's.
  const deskEditsOneBranch = (editable: 0 | 1) => {
    const state = getState();
    const receptionist = state.roles.find(
      (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist",
    )!;
    receptionist.permissions.push("view:schedules:clinic", "update:schedules:branch");
    const [b0, b1] = state.branches.filter((b) => b.clinicId === clinicIdAt(0));
    const desk = state.members.find(
      (m) => m.clinicId === clinicIdAt(0) && m.roleId === receptionist.id && m.status === "active",
    )!;
    desk.branchIds = [[b0!, b1!][editable]!.id];
    // The provider works in b0 only and still holds a row left in b1 (dormant there).
    const doc = state.members.find(
      (m) =>
        m.clinicId === clinicIdAt(0) &&
        m.id !== desk.id &&
        m.status === "active" &&
        !m.allBranches &&
        m.branchIds.length === 1 &&
        m.branchIds[0] === b0!.id,
    )!;
    for (const m of state.members) {
      const accepts = m.id === doc.id;
      state.bookingProfiles[m.id] = { acceptsAppointments: accepts, defaultDurationMinutes: 20 };
    }
    state.scheduleRows.push({
      id: crypto.randomUUID(),
      clinicId: clinicIdAt(0),
      membershipId: doc.id,
      branchId: b1!.id,
      weekday: 2,
      startsAt: "08:00",
      endsAt: "12:00",
    });
  };
  const button = (name: string) => screen.queryByRole("button", { name });

  it("NEGATIVE: the week of a branch outside the update key's branches is read-only", async () => {
    deskEditsOneBranch(1);
    renderAsDesk();
    expect(await screen.findByText(ar.schedules.dormant.title)).toBeInTheDocument();
    await screen.findByText(ar.schedules.weekTitle);
    expect(await screen.findByRole("button", { name: ar.schedules.dormant.clear })).toBeEnabled();
    expect(button(ar.schedules.saveWeek)).toBeNull();
    expect(button(ar.schedules.addShift)).toBeNull();
  });

  it("NEGATIVE: rows left in a branch outside the update key's branches cannot be cleared", async () => {
    deskEditsOneBranch(0);
    renderAsDesk();
    expect(await screen.findByRole("button", { name: ar.schedules.saveWeek })).toBeEnabled();
    expect(button(ar.schedules.addShift)).not.toBeNull();
    expect(screen.getByText(ar.schedules.dormant.title)).toBeInTheDocument();
    expect(button(ar.schedules.dormant.clear)).toBeNull();
  });
});
