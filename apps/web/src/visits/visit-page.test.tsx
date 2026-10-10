import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { api, doctorAt, getState, startDraft } from "./medical-test-kit";
import { renderAs } from "./medical-ui-kit";
import { VisitPage } from "./visit-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));

beforeEach(() => resetMockData());
afterEach(() => cleanup());

const button = (name: string) => screen.queryByRole("button", { name: new RegExp(name) });

describe("the visit page controls", () => {
  it("a draft shows Sign, Cancel draft and editable note sections to its provider", async () => {
    const { visit } = await startDraft();
    await renderAs(doctorAt(0), <VisitPage visitId={visit.id} />);
    await screen.findByText(ar.visit.note);
    expect(button(ar.visit.sign)).not.toBeNull();
    expect(button(ar.visit.cancel)).not.toBeNull();
    expect(screen.getByLabelText(ar.visit.sections.complaint).tagName).toBe("TEXTAREA");
    expect(button(ar.visit.addAddendum)).toBeNull();
  });

  it("a signed visit is locked and offers Add addendum", async () => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    await api.medical.saveNote(D, visit.id, {
      complaint: "A",
      examination: null,
      assessment: null,
      plan: null,
    });
    await api.medical.signVisit(D, visit.id);
    await renderAs(D, <VisitPage visitId={visit.id} />);
    await screen.findByText(ar.visit.lockedNote);
    expect(button(ar.visit.sign)).toBeNull();
    expect(button(ar.visit.addAddendum)).not.toBeNull();
    expect(screen.getByText(ar.visit.sections.complaint).nextElementSibling?.tagName).toBe("P");
  });

  it("a cancelled draft shows no write control", async () => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    await api.medical.cancelVisit(D, visit.id, { reason: "other", note: null });
    await renderAs(D, <VisitPage visitId={visit.id} />);
    await screen.findByText(ar.visit.cancelledNote);
    for (const name of [ar.visit.sign, ar.visit.cancel, ar.visit.addAddendum, ar.visit.print]) {
      expect(button(name)).toBeNull();
    }
  });

  it("the front desk sees the visit header but not its content", async () => {
    const { visit } = await startDraft();
    const deskRole = getState().roles.find((r) => r.systemKey === "receptionist")!;
    for (const m of getState().members) if (m.roleId === deskRole.id) m.allBranches = true;
    await renderAs(as("receptionist"), <VisitPage visitId={visit.id} />);
    await screen.findByText(ar.visits.contentHidden);
    expect(screen.queryByText(ar.visit.note)).toBeNull();
  });

  it("a diagnosis row switches between free text and an ICD-10 code", async () => {
    const { visit } = await startDraft();
    await renderAs(doctorAt(0), <VisitPage visitId={visit.id} />);
    fireEvent.click(await screen.findByRole("button", { name: ar.visit.addDiagnosis }));
    expect(screen.getByLabelText(ar.visit.diagnosisText)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: ar.visit.kindLabel }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: ar.visit.icdPick })).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(ar.visit.diagnosisText)).toBeNull();
  });
});
