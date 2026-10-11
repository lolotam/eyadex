import type { ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import type { StoredVisit } from "@/shared/api/mock/mock-medical-state";
import { ar } from "@/shared/i18n/ar";
import { api, doctorAt, getState, holdFirst, startDraft } from "./medical-test-kit";
import { renderAs } from "@/shared/persona/persona-test-kit";
import { VisitPage } from "./visit-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
  useBlocker: () => undefined,
}));
// The page must call the kit's client: `ApiProvider` builds its own, which a spy could never hold.
vi.mock("@/shared/api/api-provider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/api-provider")>();
  const kit = await import("@/shared/api/mock/mock-test-kit");
  return { ...real, useApi: () => kit.api };
});

beforeEach(() => resetMockData());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOTE = { complaint: "Headache", examination: null, assessment: null, plan: null };
const pause = (ms: number) => act(() => new Promise<void>((done) => setTimeout(done, ms)));

const SECTIONS = [
  {
    section: "diagnoses",
    method: "saveDiagnoses",
    add: ar.visit.addDiagnosis,
    field: ar.visit.diagnosisText,
    save: ar.visit.saveDiagnoses,
    typed: "Migraine",
    saved: (v: StoredVisit) => v.diagnoses.filter((d) => !d.archived).map((d) => d.text),
  },
  {
    section: "prescription",
    method: "savePrescription",
    add: ar.visit.addItem,
    field: ar.visit.item.medicine,
    save: ar.visit.savePrescription,
    typed: "Paracetamol",
    saved: (v: StoredVisit) => v.prescription.filter((p) => !p.archived).map((p) => p.medicine),
  },
] as const;

describe("Sign and the section saves (Codex PR #68)", () => {
  it.each(SECTIONS)(
    "a $section save started before the confirm turns Sign off, and the sign waits for it",
    async ({ method, add, field, save, typed, saved }) => {
      const D = doctorAt(0);
      const { visit } = await startDraft();
      // A saved note makes the draft signable (spec §4), so Sign is offered.
      await api.medical.saveNote(D, visit.id, NOTE);
      const hold = holdFirst(method);
      const realSign = api.medical.signVisit.bind(api.medical);
      const sectionSavedAtSign: boolean[] = [];
      vi.spyOn(api.medical, "signVisit").mockImplementation((persona, visitId) => {
        sectionSavedAtSign.push(hold.firstDone());
        return realSign(persona, visitId);
      });
      await renderAs(D, <VisitPage visitId={visit.id} />);
      fireEvent.click(await screen.findByRole("button", { name: add }));
      fireEvent.change(screen.getByLabelText(field), { target: { value: typed } });
      const signButton = screen.getByRole("button", { name: new RegExp(ar.visit.sign) });
      fireEvent.click(signButton);
      const dialog = await screen.findByRole("alertdialog");
      // The save starts while the confirm is open: the page behind the dialog is hidden, not gone.
      fireEvent.click(screen.getByRole("button", { name: save, hidden: true }));
      await waitFor(() => expect(hold.sent).toHaveLength(1));
      await waitFor(() => expect(signButton).toBeDisabled());
      fireEvent.click(within(dialog).getByRole("button", { name: ar.visit.sign }));
      await pause(50);
      expect(api.medical.signVisit).not.toHaveBeenCalled();
      hold.release();
      await screen.findByText(ar.visit.lockedNote);
      expect(sectionSavedAtSign).toEqual([true]);
      const stored = getState().medical.visits.find((v) => v.id === visit.id)!;
      expect([stored.status, saved(stored)]).toEqual(["signed", [typed]]);
    },
    10_000,
  );
});

describe("the sign confirm while it waits (Codex 4241453962)", () => {
  it("refuses Escape and Cancel until the held save lands, then signs and closes", async () => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    await api.medical.saveNote(D, visit.id, NOTE);
    const hold = holdFirst("saveNote");
    vi.spyOn(api.medical, "signVisit");
    await renderAs(D, <VisitPage visitId={visit.id} />);
    const complaint = await screen.findByLabelText(ar.visit.sections.complaint);
    fireEvent.change(complaint, { target: { value: "Typed right before signing" } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(ar.visit.sign) }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: ar.visit.sign }));
    await waitFor(() => expect(hold.sent).toHaveLength(1));
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(within(dialog).getByRole("button", { name: ar.common.cancel }));
    await pause(50);
    expect(screen.getByRole("alertdialog")).toBe(dialog);
    expect(api.medical.signVisit).not.toHaveBeenCalled();
    hold.release();
    await screen.findByText(ar.visit.lockedNote);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    const stored = getState().medical.visits.find((v) => v.id === visit.id)!;
    expect([stored.status, stored.note.complaint]).toEqual([
      "signed",
      "Typed right before signing",
    ]);
  }, 10_000);
});

describe("Sign after a section save failed (Codex PR #68)", () => {
  it("a diagnoses save that keeps failing keeps the visit unsigned and shows the error again until it saves", async () => {
    const D = doctorAt(0);
    const { visit } = await startDraft();
    await api.medical.saveNote(D, visit.id, NOTE);
    const errorToast = vi.spyOn(toast, "error");
    // The provider's save fails, and so does the retry Sign makes of the unsaved list (Codex 4241757315).
    vi.spyOn(api.medical, "saveDiagnoses")
      .mockRejectedValueOnce(new ApiError("unknown"))
      .mockRejectedValueOnce(new ApiError("unknown"));
    vi.spyOn(api.medical, "signVisit");
    await renderAs(D, <VisitPage visitId={visit.id} />);
    fireEvent.click(await screen.findByRole("button", { name: ar.visit.addDiagnosis }));
    fireEvent.change(screen.getByLabelText(ar.visit.diagnosisText), {
      target: { value: "Migraine" },
    });
    fireEvent.click(screen.getByRole("button", { name: ar.visit.saveDiagnoses }));
    await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(ar.visit.sign) }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: ar.visit.sign }));
    await waitFor(() => expect(api.medical.saveDiagnoses).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(errorToast.mock.calls.at(-1)![0]).toBe(ar.errors.unknown));
    expect(api.medical.signVisit).not.toHaveBeenCalled();
    expect(getState().medical.visits.find((v) => v.id === visit.id)!.status).toBe("draft");
    // Saving the section again clears it: the next confirm signs, with the saved list.
    fireEvent.click(screen.getByRole("button", { name: ar.visit.saveDiagnoses, hidden: true }));
    await waitFor(() => expect(api.medical.saveDiagnoses).toHaveBeenCalledTimes(3));
    fireEvent.click(within(dialog).getByRole("button", { name: ar.visit.sign }));
    await screen.findByText(ar.visit.lockedNote);
    const stored = getState().medical.visits.find((v) => v.id === visit.id)!;
    expect([stored.status, stored.diagnoses.map((d) => d.text)]).toEqual(["signed", ["Migraine"]]);
  }, 10_000);
});

describe("Cancel draft and the section saves (Codex PR #68)", () => {
  it.each(SECTIONS)(
    "a held $section save makes the cancel wait; the saved list stays on the cancelled visit",
    async ({ method, add, field, save, typed, saved }) => {
      const D = doctorAt(0);
      const { visit } = await startDraft();
      const hold = holdFirst(method);
      const realCancel = api.medical.cancelVisit.bind(api.medical);
      const sectionSavedAtCancel: boolean[] = [];
      vi.spyOn(api.medical, "cancelVisit").mockImplementation((persona, visitId, input) => {
        sectionSavedAtCancel.push(hold.firstDone());
        return realCancel(persona, visitId, input);
      });
      await renderAs(D, <VisitPage visitId={visit.id} />);
      fireEvent.click(await screen.findByRole("button", { name: add }));
      fireEvent.change(screen.getByLabelText(field), { target: { value: typed } });
      const cancelButton = screen.getByRole("button", { name: ar.visit.cancel });
      fireEvent.click(cancelButton);
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(screen.getByRole("button", { name: save, hidden: true }));
      await waitFor(() => expect(hold.sent).toHaveLength(1));
      await waitFor(() => expect(cancelButton).toBeDisabled());
      fireEvent.click(within(dialog).getByRole("button", { name: ar.visit.cancel }));
      await pause(50);
      expect(api.medical.cancelVisit).not.toHaveBeenCalled();
      hold.release();
      await screen.findByText(ar.visit.cancelledNote);
      expect(sectionSavedAtCancel).toEqual([true]);
      const stored = getState().medical.visits.find((v) => v.id === visit.id)!;
      expect([stored.status, saved(stored)]).toEqual(["cancelled", [typed]]);
    },
    10_000,
  );

  it("a note typed just before the confirm is saved first, then the visit is cancelled", async () => {
    const { visit } = await startDraft();
    const hold = holdFirst("saveNote");
    await renderAs(doctorAt(0), <VisitPage visitId={visit.id} />);
    const complaint = await screen.findByLabelText(ar.visit.sections.complaint);
    fireEvent.change(complaint, { target: { value: "Typed right before cancelling" } });
    fireEvent.click(screen.getByRole("button", { name: ar.visit.cancel }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: ar.visit.cancel }));
    await waitFor(() => expect(hold.sent).toHaveLength(1));
    await pause(50);
    expect(within(dialog).getByRole("button", { name: ar.visit.cancel })).toBeDisabled();
    hold.release();
    await screen.findByText(ar.visit.cancelledNote);
    const stored = getState().medical.visits.find((v) => v.id === visit.id)!;
    expect([stored.status, stored.note.complaint]).toEqual([
      "cancelled",
      "Typed right before cancelling",
    ]);
  }, 10_000);
});
