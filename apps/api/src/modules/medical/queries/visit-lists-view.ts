import type { diagnosisSchema, prescriptionItemSchema } from "@eyadex/contracts/visits";
import type { z } from "zod";

import type { DiagnosisItem, PrescriptionItem } from "../domain/visit-lists.ts";
import type { StoredDiagnosis } from "../persistence/pg-diagnosis-store.ts";
import {
  PRESCRIPTION_FIELDS,
  type StoredPrescriptionItem,
} from "../persistence/pg-prescription-store.ts";
import type { ClinicalCipher } from "../ports/clinical-cipher.ts";
import { openOrNull } from "../use-cases/medical-deps.ts";

export type DiagnosisView = z.infer<typeof diagnosisSchema>;
export type PrescriptionItemView = z.infer<typeof prescriptionItemSchema>;

/**
 * Opens active diagnoses; each envelope is bound to its own row (ADR-0028).
 *
 * @returns the diagnoses as the visit page shows them, in list order
 */
export function openDiagnoses(
  cipher: ClinicalCipher,
  clinicId: string,
  stored: readonly StoredDiagnosis[],
): DiagnosisView[] {
  return stored.map((d) => {
    const ref = (column: string) => ({ table: "visit_diagnoses", column, rowId: d.id });
    return {
      position: d.position,
      kind: d.kind,
      code: openOrNull(cipher, clinicId, ref("code_enc"), d.codeEnc),
      text: cipher.open(clinicId, ref("text_enc"), d.textEnc),
    };
  });
}

/**
 * Opens active prescription items; each envelope is bound to its own row (ADR-0028).
 *
 * @returns the items as the visit page and the print show them, in list order
 */
export function openPrescription(
  cipher: ClinicalCipher,
  clinicId: string,
  stored: readonly StoredPrescriptionItem[],
): PrescriptionItemView[] {
  return stored.map((item) => {
    const open = (field: (typeof PRESCRIPTION_FIELDS)[number]) =>
      openOrNull(
        cipher,
        clinicId,
        { table: "visit_prescription_items", column: `${field}_enc`, rowId: item.id },
        item.sealed[field],
      );
    return {
      position: item.position,
      medicine: open("medicine") ?? "",
      dose: open("dose") ?? "",
      frequency: open("frequency") ?? "",
      duration: open("duration") ?? "",
      note: open("note"),
    };
  });
}

/** A view without its position: the shape the replace compares against the new list. */
export const asDiagnosisItem = ({ kind, code, text }: DiagnosisView): DiagnosisItem => ({
  kind,
  code,
  text,
});

export const asPrescriptionItem = ({
  medicine,
  dose,
  frequency,
  duration,
  note,
}: PrescriptionItemView): PrescriptionItem => ({ medicine, dose, frequency, duration, note });
