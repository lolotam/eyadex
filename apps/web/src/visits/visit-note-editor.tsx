import { useEffect, useRef, useState } from "react";
import type { VisitDetail, VisitNoteInput } from "@eyadex/contracts/visits";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useVisitWrite } from "./use-visit-write";

const SECTIONS = ["complaint", "examination", "assessment", "plan"] as const;
const AUTOSAVE_MS = 900;

type Note = NonNullable<VisitDetail["content"]>["note"];

/** The four note sections; on an editable draft each change autosaves after a short pause. */
export function VisitNoteEditor({
  visitId,
  note,
  editable,
}: {
  visitId: string;
  note: Note;
  editable: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState<Note>(note);
  const dirty = useRef(false);
  const save = useVisitWrite<VisitNoteInput>(visitId, (api, persona, input) =>
    api.saveNote(persona, visitId, input),
  );
  const { mutate } = save;
  useEffect(() => {
    if (!dirty.current || !editable) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      mutate(value);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [value, editable, mutate]);

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
                  setValue((v) => ({ ...v, [key]: text === "" ? null : text }));
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
