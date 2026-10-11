import type { ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import type { StoredVisit } from "@/shared/api/mock/mock-medical-state";
import { ar } from "@/shared/i18n/ar";
import { api, doctorAt, getState, holdFirst, startDraft } from "./medical-test-kit";
import { renderAs } from "./medical-ui-kit";
import { VisitPage } from "./visit-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
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
