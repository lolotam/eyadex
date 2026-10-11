import type { ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import type { StoredVisit } from "@/shared/api/mock/mock-medical-state";
import { ar } from "@/shared/i18n/ar";
import { renderAs } from "@/shared/persona/persona-test-kit";
import { api, doctorAt, getState, holdFirst, startDraft } from "./medical-test-kit";
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

// Codex 4241757315: a list form's edits made after its last save, or during it, are saved through the
// form's own validated save before the visit is signed (or cancelled, which keeps its content, P2-6).
const NOTE = { complaint: "Headache", examination: null, assessment: null, plan: null };
const SECTIONS = [
  {
    section: "diagnoses",
    method: "saveDiagnoses",
    add: ar.visit.addDiagnosis,
    field: ar.visit.diagnosisText,
    save: ar.visit.saveDiagnoses,
    saved: (v: StoredVisit) => v.diagnoses.filter((d) => !d.archived).map((d) => d.text),
  },
  {
    section: "prescription",
    method: "savePrescription",
    add: ar.visit.addItem,
    field: ar.visit.item.medicine,
    save: ar.visit.savePrescription,
    saved: (v: StoredVisit) => v.prescription.filter((p) => !p.archived).map((p) => p.medicine),
  },
] as const;

const stored = (id: string) => getState().medical.visits.find((v) => v.id === id)!;
const pause = (ms: number) => act(() => new Promise<void>((done) => setTimeout(done, ms)));

async function signableDraftOnPage() {
  const { visit } = await startDraft();
  await api.medical.saveNote(doctorAt(0), visit.id, NOTE);
  await renderAs(doctorAt(0), <VisitPage visitId={visit.id} />);
  return visit.id;
}

async function confirmSign() {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(ar.visit.sign) }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: ar.visit.sign }));
}

describe("Sign saves a list edited after its last save", () => {
  it.each(SECTIONS)(
    "$section: the signed visit has the newer list",
    async (s) => {
      const id = await signableDraftOnPage();
      fireEvent.click(await screen.findByRole("button", { name: s.add }));
      fireEvent.change(screen.getByLabelText(s.field), { target: { value: "First" } });
      fireEvent.click(screen.getByRole("button", { name: s.save }));
      await waitFor(() => expect(s.saved(stored(id))).toEqual(["First"]));
      fireEvent.change(screen.getByLabelText(s.field), { target: { value: "Second" } });
      await confirmSign();
      await screen.findByText(ar.visit.lockedNote);
      expect([stored(id).status, s.saved(stored(id))]).toEqual(["signed", ["Second"]]);
    },
    10_000,
  );

  it.each(SECTIONS)(
    "$section: an edit made while its save runs, Sign pressed meanwhile, is saved too",
    async (s) => {
      const id = await signableDraftOnPage();
      const hold = holdFirst(s.method);
      fireEvent.click(await screen.findByRole("button", { name: s.add }));
      fireEvent.change(screen.getByLabelText(s.field), { target: { value: "First" } });
      fireEvent.click(screen.getByRole("button", { name: new RegExp(ar.visit.sign) }));
      const dialog = await screen.findByRole("alertdialog");
      // The page behind the confirm is hidden, not gone: the save starts and the edit goes on.
      fireEvent.click(screen.getByRole("button", { name: s.save, hidden: true }));
      await waitFor(() => expect(hold.sent).toHaveLength(1));
      fireEvent.change(screen.getByLabelText(s.field), { target: { value: "Second" } });
      fireEvent.click(within(dialog).getByRole("button", { name: ar.visit.sign }));
      await pause(50);
      expect(stored(id).status).toBe("draft");
      hold.release();
      await screen.findByText(ar.visit.lockedNote);
      expect([stored(id).status, s.saved(stored(id))]).toEqual(["signed", ["Second"]]);
    },
    10_000,
  );

  it("an incomplete diagnosis row refuses the sign, naming the section; the visit stays a draft", async () => {
    const errorToast = vi.spyOn(toast, "error");
    vi.spyOn(api.medical, "signVisit");
    const id = await signableDraftOnPage();
    fireEvent.click(await screen.findByRole("button", { name: ar.visit.addDiagnosis }));
    await confirmSign();
    const refusal = ar.visit.sectionInvalid.replace("{section}", ar.visit.diagnoses);
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(refusal, expect.anything()));
    expect(api.medical.signVisit).not.toHaveBeenCalled();
    expect(stored(id).status).toBe("draft");
  }, 10_000);
});

describe("Cancel draft keeps the newer list (P2-6: a cancelled draft keeps its content)", () => {
  it("diagnoses edited after their save are saved before the cancel", async () => {
    const id = await signableDraftOnPage();
    fireEvent.click(await screen.findByRole("button", { name: ar.visit.addDiagnosis }));
    fireEvent.change(screen.getByLabelText(ar.visit.diagnosisText), { target: { value: "First" } });
    fireEvent.click(screen.getByRole("button", { name: ar.visit.saveDiagnoses }));
    await waitFor(() => expect(SECTIONS[0].saved(stored(id))).toEqual(["First"]));
    fireEvent.change(screen.getByLabelText(ar.visit.diagnosisText), {
      target: { value: "Second" },
    });
    fireEvent.click(screen.getByRole("button", { name: ar.visit.cancel }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: ar.visit.cancel }));
    await screen.findByText(ar.visit.cancelledNote);
    expect([stored(id).status, SECTIONS[0].saved(stored(id))]).toEqual(["cancelled", ["Second"]]);
  }, 10_000);
});
