import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisitNoteInput } from "@eyadex/contracts/visits";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { api, doctorAt, getState, holdFirst, startDraft } from "./medical-test-kit";
import { renderAs } from "@/shared/persona/persona-test-kit";
import { VisitNoteEditor } from "./visit-note-editor";
import type { NoteFlush } from "./visit-section-saves";

// The editor's leave guard, as the router would read it at navigation time and on tab close.
const blocker = vi.hoisted(() => ({
  opts: null as null | { shouldBlockFn: () => boolean; enableBeforeUnload: () => boolean },
}));
vi.mock("@tanstack/react-router", () => ({
  useBlocker: (opts: typeof blocker.opts) => {
    blocker.opts = opts;
  },
}));
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

/** The complaint of each note save sent, in order. */
const complaints = (hold: ReturnType<typeof holdFirst>) =>
  hold.sent.map((input) => (input as VisitNoteInput).complaint);

async function typedTwiceDuringOneSave() {
  const { visit } = await startDraft();
  const hold = holdFirst("saveNote");
  const flushRef: { current: NoteFlush | null } = { current: null };
  await renderAs(
    doctorAt(0),
    <VisitNoteEditor visitId={visit.id} note={EMPTY} editable flushRef={flushRef} />,
  );
  const complaint = await screen.findByLabelText(ar.visit.sections.complaint);
  fireEvent.change(complaint, { target: { value: "First draft" } });
  await waitFor(() => expect(complaints(hold)).toEqual(["First draft"]), { timeout: 3000 });
  fireEvent.change(complaint, { target: { value: "Second draft" } });
  await pause(PAST_AUTOSAVE_MS);
  return { visitId: visit.id, hold, flushRef };
}

const stored = (visitId: string) => getState().medical.visits.find((v) => v.id === visitId)!;

describe("the note autosave", () => {
  it("never sends a second save while one is in flight, and then sends the latest text", async () => {
    const { visitId, hold } = await typedTwiceDuringOneSave();
    expect(complaints(hold)).toEqual(["First draft"]);
    hold.release();
    await waitFor(() => expect(complaints(hold)).toEqual(["First draft", "Second draft"]));
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
    expect([flushed, complaints(hold)]).toEqual([false, ["First draft"]]);
    hold.release();
    await act(() => flushing);
    expect(complaints(hold)).toEqual(["First draft", "Second draft"]);
    expect(hold.most()).toBe(1);
    await api.medical.signVisit(doctorAt(0), visitId);
    expect([stored(visitId).status, stored(visitId).note.complaint]).toEqual([
      "signed",
      "Second draft",
    ]);
  }, 10_000);
});

describe("leaving with a note not saved yet", () => {
  async function typedNotSaved() {
    const { visit } = await startDraft();
    const hold = holdFirst("saveNote");
    const view = await renderAs(
      doctorAt(0),
      <VisitNoteEditor visitId={visit.id} note={EMPTY} editable />,
    );
    const complaint = await screen.findByLabelText(ar.visit.sections.complaint);
    return { visitId: visit.id, hold, view, complaint };
  }

  it("an unmount inside the autosave pause sends the latest text at once", async () => {
    const { visitId, hold, view, complaint } = await typedNotSaved();
    fireEvent.change(complaint, { target: { value: "Typed then left" } });
    view.unmount();
    await waitFor(() => expect(complaints(hold)).toEqual(["Typed then left"]));
    hold.release();
    await waitFor(() => expect(stored(visitId).note.complaint).toBe("Typed then left"));
  }, 10_000);

  it("blocks navigation and tab close only while text is unsaved, and asks first", async () => {
    const { hold, complaint } = await typedNotSaved();
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect([blocker.opts!.enableBeforeUnload(), blocker.opts!.shouldBlockFn()]).toEqual([
      false,
      false,
    ]);
    expect(ask).not.toHaveBeenCalled();
    fireEvent.change(complaint, { target: { value: "Not saved yet" } });
    expect([blocker.opts!.enableBeforeUnload(), blocker.opts!.shouldBlockFn()]).toEqual([
      true,
      true,
    ]);
    expect(ask).toHaveBeenCalledWith(ar.visit.leaveUnsaved);
    ask.mockReturnValue(true);
    expect(blocker.opts!.shouldBlockFn()).toBe(false);
    hold.release();
    await waitFor(() => expect(complaints(hold)).toEqual(["Not saved yet"]), { timeout: 3000 });
    await waitFor(() => expect(blocker.opts!.enableBeforeUnload()).toBe(false));
  }, 10_000);
});
