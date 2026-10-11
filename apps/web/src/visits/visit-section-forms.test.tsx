import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisitDetail } from "@eyadex/contracts/visits";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { renderAs } from "@/shared/persona/persona-test-kit";
import { doctorAt, holdFirst, startDraft } from "./medical-test-kit";
import { VisitDiagnoses } from "./visit-diagnoses";
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

// Past the note editor's 900 ms autosave pause.
const PAST_AUTOSAVE_MS = 1200;
const pause = (ms: number) => act(() => new Promise<void>((done) => setTimeout(done, ms)));

const SECTIONS = [
  {
    section: "diagnoses",
    method: "saveDiagnoses",
    add: ar.visit.addDiagnosis,
    field: ar.visit.diagnosisText,
    save: ar.visit.saveDiagnoses,
    typed: "Migraine",
  },
  {
    section: "prescription",
    method: "savePrescription",
    add: ar.visit.addItem,
    field: ar.visit.item.medicine,
    save: ar.visit.savePrescription,
    typed: "Paracetamol",
  },
] as const;

async function openDraftAndType(add: string, field: string, typed: string) {
  const { visit } = await startDraft();
  await renderAs(doctorAt(0), <VisitPage visitId={visit.id} />);
  fireEvent.click(await screen.findByRole("button", { name: add }));
  fireEvent.change(screen.getByLabelText(field), { target: { value: typed } });
}

describe("a section form and the visit's other writes (Codex PR #68)", () => {
  it.each(SECTIONS)(
    "$section text typed and not saved survives a note autosave",
    async ({ add, field, typed }) => {
      await openDraftAndType(add, field, typed);
      fireEvent.change(screen.getByLabelText(ar.visit.sections.complaint), {
        target: { value: "Headache" },
      });
      await pause(PAST_AUTOSAVE_MS);
      await screen.findByText(ar.visit.savedAt);
      expect(screen.getByLabelText(field)).toHaveValue(typed);
    },
    10_000,
  );

  it.each(SECTIONS)(
    "a $section edit made while its own save is in flight survives that save",
    async ({ method, add, field, save, typed }) => {
      await openDraftAndType(add, field, typed);
      const hold = holdFirst(method);
      const saved = vi.spyOn(toast, "success");
      fireEvent.click(screen.getByRole("button", { name: save }));
      await waitFor(() => expect(hold.sent).toHaveLength(1));
      fireEvent.change(screen.getByLabelText(field), { target: { value: `${typed} 2` } });
      hold.release();
      await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
      expect(screen.getByLabelText(field)).toHaveValue(`${typed} 2`);
    },
    10_000,
  );
});

type Diagnoses = NonNullable<VisitDetail["content"]>["diagnoses"];

describe("a section form with nothing typed", () => {
  it("shows the server's list as soon as it changes", async () => {
    const { visit } = await startDraft();
    const push: { current: (next: Diagnoses) => void } = { current: () => undefined };
    function Harness() {
      const [diagnoses, setDiagnoses] = useState<Diagnoses>([]);
      push.current = setDiagnoses;
      return <VisitDiagnoses visitId={visit.id} diagnoses={diagnoses} editable />;
    }
    await renderAs(doctorAt(0), <Harness />);
    act(() => push.current([{ position: 0, kind: "text", code: null, text: "Asthma" }]));
    expect(await screen.findByLabelText(ar.visit.diagnosisText)).toHaveValue("Asthma");
  });
});
