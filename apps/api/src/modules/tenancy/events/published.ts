import type { Tx } from "@eyadex/db";

import { appendOutboxEvent } from "../../../shared/outbox.ts";

/**
 * حدث تعطيل فرع (ADR-0013 §12). الـ worker بيلغي الدعوات المعلّقة اللي مابقالهاش فرع نشط؛ tenancy
 * نفسها ماتكتبش في الدعوات أبدًا ولا بتقراها عشان تقرر تبعت الحدث.
 */
export const BRANCH_DEACTIVATED_EVENT = "clinic.branch_deactivated";

/**
 * محتوى الحدث، أقل حاجة ممكنة: مفيش أسماء ولا إيميلات ولا أرقام تليفون.
 */
export interface BranchDeactivatedPayload {
  readonly clinicId: string;
  readonly branchId: string;
  /** الأدمن اللي عطّل الفرع: هو الفاعل في سجل الإلغاء التلقائي. */
  readonly actorUserId: string;
  /** ISO 8601. */
  readonly deactivatedAt: string;
}

/**
 * بيضيف حدث `clinic.branch_deactivated` جوه نفس transaction التعطيل، فيا الاتنين يتكتبوا يا ولا حاجة.
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param eventId id الحدث (UUID v7 من التطبيق)
 * @param payload محتوى الحدث
 * @param createdAt وقت التعطيل
 * @returns بيخلص لما الصف يتكتب
 */
export function publishBranchDeactivated(
  tx: Tx,
  eventId: string,
  payload: BranchDeactivatedPayload,
  createdAt: Date,
): Promise<void> {
  return appendOutboxEvent(tx, {
    id: eventId,
    clinicId: payload.clinicId,
    type: BRANCH_DEACTIVATED_EVENT,
    payload: { ...payload },
    createdAt,
  });
}
