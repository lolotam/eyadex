import { scrubAuditText } from "@eyadex/observability";

/** إجازة متخزّنة (D-6). `cancelledAt` = اتلغت (مفيش حذف نهائي). */
export interface TimeOffRecord {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly note: string | null;
  readonly cancelledAt: Date | null;
}

/**
 * الملاحظة بعد العقد (اتشالت منها الرموز المخفية واتقصّت): فاضية = مفيش ملاحظة.
 *
 * @param note الملاحظة من الطلب
 * @returns الملاحظة، أو `null`
 */
export function normalizeNote(note: string | null): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * إلغاء إجازة: الملغية قبل كده = نفس الرد من غير صف سجل.
 *
 * @param record الإجازة
 * @returns `same` أو `cancel`
 */
export function decideTimeOffCancel(record: TimeOffRecord): "same" | "cancel" {
  return record.cancelledAt === null ? "cancel" : "same";
}

/**
 * لقطة السجل: المدة وحالة الإلغاء بس. الملاحظة نص حر عن غياب شخص، فعمرها ما بتتسجل (ADR-0026 §7).
 *
 * @param providerName اسم العضو
 * @param record الإجازة
 * @returns اللقطة
 */
export function timeOffAuditSnapshot(providerName: string, record: TimeOffRecord) {
  return {
    providerName: scrubAuditText(providerName),
    startsAt: record.startsAt.toISOString(),
    endsAt: record.endsAt.toISOString(),
    cancelled: record.cancelledAt !== null,
  };
}
