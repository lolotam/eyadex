import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisitNoteInput } from "@eyadex/contracts/visits";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { api, doctorAt, getState, startDraft } from "./medical-test-kit";
import { renderAs } from "./medical-ui-kit";
import { VisitNoteEditor } from "./visit-note-editor";
import type { NoteFlush } from "./visit-note-save";

// The editor must call the kit's client: `ApiProvider` builds its own, which a spy could never hold.
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

const EMPTY = { complaint: null, examination: null, assessment: null, plan: null };
// Past the editor's 900 ms autosave pause.
const PAST_AUTOSAVE_MS = 1200;
const pause = (ms: number) => act(() => new Promise<void>((done) => setTimeout(done, ms)));

/** Holds the first note save before it reaches the store, and counts the saves running together. */
function holdFirstSave() {
  const real = api.medical.saveNote.bind(api.medical);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((done) => (release = done));
  const sent: (string | null)[] = [];
  let running = 0;
  let most = 0;
  vi.spyOn(api.medical, "saveNote").mockImplementation(async (persona, visitId, input) => {
    sent.push((input as VisitNoteInput).complaint);
    running += 1;
    most = Math.max(most, running);
    try {
      if (sent.length === 1) await gate;
      return await real(persona, visitId, input);
    } finally {
      running -= 1;
    }
  });
  return { sent, release, most: () => most, running: () => running };
}

async function typedTwiceDuringOneSave() {
  const { visit } = await startDraft();
  const hold = holdFirstSave();
  const flushRef: { current: NoteFlush | null } = { current: null };
  await renderAs(
    doctorAt(0),
    <VisitNoteEditor visitId={visit.id} note={EMPTY} editable flushRef={flushRef} />,
  );
  const complaint = await screen.findByLabelText(ar.visit.sections.complaint);
  fireEvent.change(complaint, { target: { value: "First draft" } });
  await waitFor(() => expect(hold.sent).toEqual(["First draft"]), { timeout: 3000 });
  fireEvent.change(complaint, { target: { value: "Second draft" } });
  await pause(PAST_AUTOSAVE_MS);
  return { visitId: visit.id, hold, flushRef };
}

const stored = (visitId: string) => getState().medical.visits.find((v) => v.id === visitId)!;

describe("the note autosave", () => {
  it("never sends a second save while one is in flight, and then sends the latest text", async () => {
    const { visitId, hold } = await typedTwiceDuringOneSave();
    expect(hold.sent).toEqual(["First draft"]);
    hold.release();
    await waitFor(() => expect(hold.sent).toEqual(["First draft", "Second draft"]));
    await waitFor(() => expect(hold.running()).toBe(0));
    expect(hold.most()).toBe(1);
    expect(stored(visitId).note.complaint).toBe("Second draft");
  }, 10_000);

  it("a flush waits for the running save and the queued latest text; signing then keeps it", async () => {
    const { visitId, hold, flushRef } = await typedTwiceDuringOneSave();
    let flushed = false;
    const flushing = flushRef.current!().then(() => {
      flushed = true;
    });
    await pause(50);
    expect([flushed, hold.sent]).toEqual([false, ["First draft"]]);
    hold.release();
    await act(() => flushing);
    expect(hold.sent).toEqual(["First draft", "Second draft"]);
    expect(hold.most()).toBe(1);
    await api.medical.signVisit(doctorAt(0), visitId);
    expect([stored(visitId).status, stored(visitId).note.complaint]).toEqual([
      "signed",
      "Second draft",
    ]);
  }, 10_000);
});
