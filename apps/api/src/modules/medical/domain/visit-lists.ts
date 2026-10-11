import type { DiagnosisInput, PrescriptionItemInput } from "@eyadex/contracts/visits";

import { sectionValue } from "./visit-rules.ts";

/** تشخيص زي ما بيتحفظ ويتعرض: نوعه، والكود لو ICD-10، والنص. */
export interface DiagnosisItem {
  readonly kind: "icd10" | "text";
  readonly code: string | null;
  readonly text: string;
}

/** دوا في الروشتة زي ما بيتحفظ ويتعرض؛ الملاحظة الفاضية `null`. */
export interface PrescriptionItem {
  readonly medicine: string;
  readonly dose: string;
  readonly frequency: string;
  readonly duration: string;
  readonly note: string | null;
}

/**
 * P2-8: التشخيص من مدخلات العقد للشكل المتخزّن؛ تشخيص النص الحر مالوش كود.
 *
 * @param input التشخيص بعد `diagnosisInputSchema`
 * @returns التشخيص
 */
export function diagnosisItem(input: DiagnosisInput): DiagnosisItem {
  return input.kind === "icd10"
    ? { kind: "icd10", code: input.code, text: input.text }
    : { kind: "text", code: null, text: input.text };
}

/**
 * P2-9: الدوا من مدخلات العقد للشكل المتخزّن؛ ملاحظة من مسافات بس = `null` (R1-8).
 *
 * @param input الدوا بعد `prescriptionItemInputSchema`
 * @returns الدوا
 */
export function prescriptionItem(input: PrescriptionItemInput): PrescriptionItem {
  return {
    medicine: input.medicine,
    dose: input.dose,
    frequency: input.frequency,
    duration: input.duration,
    note: sectionValue(input.note),
  };
}

/**
 * هل القايمتين متطابقتين بالترتيب؟ نفس القايمة = مفيش كتابة ولا صف سجل (زي حفظ الملاحظة).
 *
 * @param before القايمة النشطة دلوقتي
 * @param after القايمة الجديدة
 * @returns `true` لو كل عنصر زي اللي في مكانه
 */
export function sameList<T extends object>(before: readonly T[], after: readonly T[]): boolean {
  if (before.length !== after.length) return false;
  return before.every((item, i) => {
    const other = after[i] as Record<string, unknown>;
    return Object.entries(item).every(([key, value]) => other[key] === value);
  });
}

/**
 * P2-F1، R2-8: أكواد ICD-10 في القايمة اللي مش موجودة في الجدول أو مش صالحة للتشخيص (عناوين أقسام).
 *
 * @param items التشخيصات
 * @param billable الأكواد الصالحة اللي لقيناها في الجدول
 * @returns `true` لو فيه كود واحد على الأقل مش صالح (`icd10_unknown`)
 */
export function hasUnknownCode(
  items: readonly DiagnosisItem[],
  billable: ReadonlySet<string>,
): boolean {
  return items.some((item) => item.code !== null && !billable.has(item.code));
}

/**
 * الأكواد اللي محتاجين نتأكد منها، من غير تكرار.
 *
 * @param items التشخيصات
 * @returns أكواد ICD-10 في القايمة
 */
export function codesOf(items: readonly DiagnosisItem[]): string[] {
  return [...new Set(items.flatMap((item) => (item.code === null ? [] : [item.code])))];
}
