import type { ReactNode } from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { renderAs } from "@/shared/persona/persona-test-kit";
import { doctorAt, getState, startDraft } from "./medical-test-kit";
import { PatientVisitsTab } from "./patient-visits-tab";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));

beforeEach(() => resetMockData());
afterEach(() => cleanup());

// The API answers `preview: null` both to a reader of a visit without an assessment and to a caller who
// may not read it; the list's `can.search` (the content reach) tells the two apart.
describe("a visit row's preview line", () => {
  it.each([
    ["the doctor sees the no-assessment placeholder", () => doctorAt(0), true],
    ["the front desk sees no preview line", () => as("receptionist"), false],
  ])("%s", async (_case, persona, shown) => {
    const { visit } = await startDraft();
    for (const v of getState().medical.visits) {
      if (v.patientId === visit.patientId) v.note.assessment = null;
    }
    const deskRole = getState().roles.find((r) => r.systemKey === "receptionist")!;
    for (const m of getState().members) if (m.roleId === deskRole.id) m.allBranches = true;
    await renderAs(persona(), <PatientVisitsTab patientId={visit.patientId} />);
    await screen.findAllByText(visit.providerName);
    expect(screen.queryAllByText(ar.visits.noPreview).length > 0).toBe(shown);
  });
});
