import type { ProviderSchedule } from "@eyadex/contracts/schedules";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiProvider } from "@/shared/api/api-provider";
import { as } from "@/shared/api/mock/mock-test-kit";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaContext } from "@/shared/persona/persona-context";
import { WeeklyScheduleEditor } from "./weekly-schedule-editor";

afterEach(() => cleanup());

const BRANCH = "00000000-0000-7000-8000-0000000000b1";
const scheduleWith = (
  shifts: ProviderSchedule["shifts"],
  timeOff: ProviderSchedule["timeOff"] = [],
): ProviderSchedule => ({
  provider: {
    membershipId: "00000000-0000-7000-8000-0000000000m1",
    fullName: "Dr Test",
    defaultDurationMinutes: 20,
    allBranches: false,
    branchIds: [BRANCH],
  },
  branches: [{ id: BRANCH, nameAr: "فرع", nameEn: "Branch", isActive: true }],
  dormantBranches: [],
  shifts,
  timeOff,
});

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  const persona = as("clinic_admin");
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ApiProvider>
          <PersonaContext.Provider value={{ persona, ready: true, setPersona: () => undefined }}>
            {children}
          </PersonaContext.Provider>
        </ApiProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

const week = [{ branchId: BRANCH, weekday: 0, startsAt: "08:00", endsAt: "12:00" }];

describe("the weekly editor keeps unsaved edits (Codex PR #63)", () => {
  it("a refetch that only changed time off leaves the edited week alone", () => {
    const { rerender } = render(
      <Wrap>
        <WeeklyScheduleEditor schedule={scheduleWith(week)} branchId={BRANCH} mayEdit />
      </Wrap>,
    );
    fireEvent.change(screen.getByDisplayValue("08:00"), { target: { value: "09:00" } });
    const timeOff = [
      {
        id: "00000000-0000-7000-8000-0000000000t1",
        startsAt: "2027-01-01T08:00:00.000Z",
        endsAt: "2027-01-02T08:00:00.000Z",
        note: null,
      },
    ];
    rerender(
      <Wrap>
        <WeeklyScheduleEditor schedule={scheduleWith(week, timeOff)} branchId={BRANCH} mayEdit />
      </Wrap>,
    );
    expect(screen.queryByDisplayValue("09:00")).not.toBeNull();
  });

  it("new saved hours for the branch replace the editor's rows", () => {
    const { rerender } = render(
      <Wrap>
        <WeeklyScheduleEditor schedule={scheduleWith(week)} branchId={BRANCH} mayEdit />
      </Wrap>,
    );
    fireEvent.change(screen.getByDisplayValue("08:00"), { target: { value: "09:00" } });
    const saved = [{ branchId: BRANCH, weekday: 0, startsAt: "10:00", endsAt: "12:00" }];
    rerender(
      <Wrap>
        <WeeklyScheduleEditor schedule={scheduleWith(saved)} branchId={BRANCH} mayEdit />
      </Wrap>,
    );
    expect(screen.queryByDisplayValue("10:00")).not.toBeNull();
    expect(screen.queryByDisplayValue("09:00")).toBeNull();
  });
});
