import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import type { VisitDetail } from "@eyadex/contracts/visits";
import { medicalKeys, useClinicPersona } from "./medical-queries";
import { SectionInvalidError, type SectionSaves } from "./visit-section-saves";

// A blank optional field and a stored null are the same value (the API's `sectionValue`).
const fieldsOf = <T>(items: readonly T[], key: (item: T) => readonly unknown[]) =>
  JSON.stringify(items.map((item) => key(item).map((v) => (v === "" ? null : v))));

/**
 * Codex 4241757315: a list form's edits made after its last save, or while that save was on its way,
 * are saved before the visit is signed or cancelled. Registered with the page's `saves`, the flush
 * reads the list the server holds now (the cached visit, updated inside the tracked save), and when
 * the form differs it submits through the form's own validated save; edits that do not validate
 * refuse the sign (`SectionInvalidError`) and show the form's errors.
 */
export function useListFlush<T>(options: {
  visitId: string;
  section: "diagnoses" | "prescription";
  saves: SectionSaves | undefined;
  editable: boolean;
  form: UseFormReturn<{ items: T[] }>;
  schema: z.ZodType<{ items: T[] }, z.ZodTypeDef, unknown>;
  serverItems: (detail: VisitDetail) => T[];
  key: (item: T) => readonly unknown[];
  submit: (input: { items: T[] }) => Promise<unknown>;
}) {
  const { personaKey } = useClinicPersona();
  const queryClient = useQueryClient();
  // The newest options and visit key without registering again on every render.
  const queryKey = [...medicalKeys.visit(options.visitId), ...personaKey];
  const latest = useRef({ ...options, queryKey });
  latest.current = { ...options, queryKey };
  const { saves, section, editable } = options;
  useEffect(() => {
    if (!saves || !editable) return;
    return saves.register(section, async () => {
      const { form, schema, serverItems, key, submit, queryKey: visitKey } = latest.current;
      const parsed = schema.safeParse(form.getValues());
      if (!parsed.success) {
        void form.trigger();
        throw new SectionInvalidError(section);
      }
      const detail = queryClient.getQueryData<VisitDetail>(visitKey);
      const stored = detail ? serverItems(detail) : [];
      if (fieldsOf(parsed.data.items, key) === fieldsOf(stored, key)) return;
      await submit(parsed.data);
    });
  }, [saves, section, editable, queryClient]);
}
