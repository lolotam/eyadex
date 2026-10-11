import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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

const NOTE = { complaint: "Earlier", examination: null, assessment: null, plan: null };
const button = (name: string) => screen.queryByRole("button", { name: new RegExp(name) });

describe("the visit page controls", () => {
  it("a draft shows Sign, Cancel draft and editable note sections to its provider", async () => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    await api.medical.saveNote(D, visit.id, NOTE);
    await renderAs(D, <VisitPage visitId={visit.id} />);
    await screen.findByText(ar.visit.note);
    expect(button(ar.visit.sign)).not.toBeNull();
    expect(button(ar.visit.cancel)).not.toBeNull();
    expect(screen.getByLabelText(ar.visit.sections.complaint).tagName).toBe("TEXTAREA");
    expect(button(ar.visit.addAddendum)).toBeNull();
  });

  it("an empty draft offers no Sign: signing needs a note section or a diagnosis (spec §4)", async () => {
    const { visit } = await startDraft();
    await renderAs(doctorAt(0), <VisitPage visitId={visit.id} />);
    await screen.findByText(ar.visit.note);
    expect(button(ar.visit.sign)).toBeNull();
    expect(button(ar.visit.cancel)).not.toBeNull();
  });

  it("Sign saves the note typed just before it, then signs the visit with that text", async () => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    await api.medical.saveNote(D, visit.id, NOTE);
    await renderAs(D, <VisitPage visitId={visit.id} />);
    const complaint = await screen.findByLabelText(ar.visit.sections.complaint);
    fireEvent.change(complaint, { target: { value: "Typed right before signing" } });
    fireEvent.click(button(ar.visit.sign)!);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: ar.visit.sign }));
    await screen.findByText(ar.visit.lockedNote);
    const stored = getState().medical.visits.find((v) => v.id === visit.id)!;
    expect([stored.status, stored.note.complaint]).toEqual([
      "signed",
      "Typed right before signing",
    ]);
    // The log is newest first: the note was saved before the visit was signed.
    const actions = getState().clinicAudit.map((r) => r.action);
    expect(actions.indexOf("visit.note_saved")).toBeGreaterThan(actions.indexOf("visit.signed"));
    expect(screen.getByText("Typed right before signing").tagName).toBe("P");
  });

  it("a note save that fails before Sign keeps the visit a draft and the dialog open", async () => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    const note = { complaint: "Saved", examination: null, assessment: null, plan: null };
    await api.medical.saveNote(D, visit.id, note);
    await renderAs(D, <VisitPage visitId={visit.id} />);
    const complaint = await screen.findByLabelText(ar.visit.sections.complaint);
    // Past the contract's limit (the textarea's maxLength is not applied to a programmatic change).
    fireEvent.change(complaint, { target: { value: "x".repeat(4001) } });
    fireEvent.click(button(ar.visit.sign)!);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: ar.visit.sign }));
    await screen.findByText(ar.visit.saveFailed);
    const stored = getState().medical.visits.find((v) => v.id === visit.id)!;
    expect([stored.status, stored.note.complaint]).toEqual(["draft", "Saved"]);
    expect(getState().clinicAudit.some((r) => r.action === "visit.signed")).toBe(false);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
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
