import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { VisitDetail, VisitNoteInput } from "@eyadex/contracts/visits";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useVisitWrite } from "./use-visit-write";
import { noteSaveKey, type NoteFlush } from "./visit-note-save";

const SECTIONS = ["complaint", "examination", "assessment", "plan"] as const;
const AUTOSAVE_MS = 900;

type Note = NonNullable<VisitDetail["content"]>["note"];

/**
 * The four note sections; on an editable draft each change autosaves after a short pause. `flushRef`
 * lets the page save what is pending before a sign, so a sign never locks an older note.
 */
export function VisitNoteEditor({
  visitId,
  note,
  editable,
  flushRef,
}: {
  visitId: string;
  note: Note;
  editable: boolean;
  flushRef?: RefObject<NoteFlush | null>;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState<Note>(note);
  const latest = useRef<Note>(note);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef<Promise<void> | null>(null);
  const save = useVisitWrite<VisitNoteInput>(
    visitId,
    (api, persona, input) => api.saveNote(persona, visitId, input),
    { mutationKey: noteSaveKey(visitId) },
  );
  const { mutateAsync } = save;
  // Single flight (Codex PR #68): two PUTs in flight could land out of order and store an older text,
  // so an edit made during a save is sent once that save settles, always as the latest text. A failed
  // save leaves the text dirty, so the next flush sends it again instead of signing without it.
  const pump = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        while (dirty.current) {
          dirty.current = false;
          try {
            await mutateAsync(latest.current);
          } catch (e) {
            dirty.current = true;
            throw e;
          }
        }
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [mutateAsync]);
  useEffect(() => {
    if (!dirty.current || !editable) return;
    timer.current = setTimeout(() => {
      // The error is shown by the write's toast; a later flush retries it.
      pump().catch(() => undefined);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer.current);
  }, [value, editable, pump]);
  const flush = useCallback<NoteFlush>(async () => {
    clearTimeout(timer.current);
    // A failed running chain left the text dirty: the second pump sends it again and its failure rejects.
    await inFlight.current?.catch(() => undefined);
    await pump();
  }, [pump]);
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = flush;
    return () => {
      flushRef.current = null;
    };
  }, [flushRef, flush]);

  const state = save.isPending
    ? t("visit.saving")
    : save.isError
      ? t("visit.saveFailed")
      : save.isSuccess
        ? t("visit.savedAt")
        : "";
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t("visit.note")}</h2>
        {editable && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {state}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-4">
        {SECTIONS.map((key) => (
          <div key={key} className="flex flex-col gap-1.5">
            <Label htmlFor={`note-${key}`}>{t(`visit.sections.${key}`)}</Label>
            {editable ? (
              <Textarea
                id={`note-${key}`}
                rows={key === "complaint" ? 2 : 3}
                value={value[key] ?? ""}
                maxLength={key === "complaint" ? 4000 : 8000}
                onChange={(e) => {
                  dirty.current = true;
                  const text = e.target.value;
                  latest.current = { ...latest.current, [key]: text === "" ? null : text };
                  setValue(latest.current);
                }}
              />
            ) : (
              <p id={`note-${key}`} className="whitespace-pre-wrap text-sm">
                {note[key] ?? <span className="text-muted-foreground">—</span>}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
