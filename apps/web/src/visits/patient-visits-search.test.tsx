import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { api, doctorAt, getState } from "./medical-test-kit";
import { renderAs } from "./medical-ui-kit";
import { PatientVisitsTab } from "./patient-visits-tab";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));

beforeEach(() => resetMockData());
afterEach(() => cleanup());

// Codex PR #68: the note search pages its matches like the list does (the API pages them by 20).
describe("the visit note search", () => {
  it("offers Next when more than one page matches, and the next page holds the rest", async () => {
    const D = doctorAt(0);
    const { items: branches } = await api.medical.walkInBranches(D);
    const branchId = branches[0]!.id;
    const patient = getState().patients.find(
      (p) => p.status === "active" && p.registrationBranchId === branchId,
    )!;
    for (let i = 0; i < 25; i += 1) {
      const { visit } = await api.medical.startVisit(
        D,
        { patientId: patient.id, branchId },
        crypto.randomUUID(),
      );
      await api.medical.saveNote(D, visit.id, {
        complaint: null,
        examination: null,
        assessment: "صداع متكرر",
        plan: null,
      });
    }
    await renderAs(D, <PatientVisitsTab patientId={patient.id} />);
    const box = await screen.findByLabelText(ar.visits.searchNotes);
    fireEvent.change(box, { target: { value: "صداع" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(20));
    fireEvent.click(screen.getByRole("button", { name: ar.common.next }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(5));
    expect(screen.queryByRole("button", { name: ar.common.next })).toBeNull();
  });
});
