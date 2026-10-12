import type { FieldRef } from "@eyadex/secrets";

import type { PrescriptionLine } from "./domain/prescription-email.ts";
import type { SealedPrescriptionLine } from "./ports/notification-store.ts";

/** الجزء اللي الـ worker بيستخدمه من `FieldCipher` (ADR-0028): الفتح بس، عمره ما بيشفّر. */
export interface FieldOpener {
  open(clinicId: string, ref: FieldRef, envelope: string): string;
}

type Field = "medicine" | "dose" | "frequency" | "duration" | "note";

/**
 * بيفتح سطور الوصفة، كل ظرف بمكانه بالظبط (الجدول والعمود وصف السطر)، زي ما الـ API بيفتحها لصفحة
 * الزيارة. أي ظرف مابيتفتحش بيرمي، والنص المفتوح بيعيش في الذاكرة لحد ما الإيميل يتبني بس.
 *
 * @param cipher الفاتح
 * @param clinicId العيادة (مفتاحها مشتق منها)
 * @param lines السطور المقفولة
 * @returns السطور بالترتيب
 */
export function openPrescriptionLines(
  cipher: FieldOpener,
  clinicId: string,
  lines: readonly SealedPrescriptionLine[],
): PrescriptionLine[] {
  return lines.map((line) => {
    const open = (field: Field, envelope: string) =>
      cipher.open(
        clinicId,
        { table: "visit_prescription_items", column: `${field}_enc`, rowId: line.id },
        envelope,
      );
    return {
      medicine: open("medicine", line.medicine),
      dose: open("dose", line.dose),
      frequency: open("frequency", line.frequency),
      duration: open("duration", line.duration),
      note: line.note === null ? null : open("note", line.note),
    };
  });
}
