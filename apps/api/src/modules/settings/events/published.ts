import type { MailProviderSlot } from "@eyadex/contracts/notifications";

import type { OutboxEvent } from "../../../shared/outbox.ts";

/** الأدمن طلب إيميل تجربة لمزود بريد العيادة؛ الـ worker بيبعته (ADR-0014، 7c-2a). */
export const MAIL_PROVIDER_TEST_REQUESTED = "clinic.mail_provider_test_requested";

/** payload الحدث: ids بس — مفيش إيميل ولا سر. الـ worker بيقرا إيميل الفاعل تحت RLS. */
export interface MailProviderTestRequested {
  readonly clinicId: string;
  readonly providerId: string;
  /** خانة المزود اللي اتطلبت تجربته (N-3). */
  readonly slot: MailProviderSlot;
  /** إصدار الإعدادات اللي اتطلبت تجربتها؛ الـ worker بيتخطّى لو الصف اتبدّل بعدها. */
  readonly providerVersion: number;
  readonly actorUserId: string;
}

/**
 * بيبني حدث طلب التجربة.
 *
 * @param id id الحدث
 * @param createdAt وقت الطلب (الـ worker بيتخطّى لو الصف اتبدّل بعده)
 * @param payload الـ ids والخانة والإصدار
 * @returns صف الـ outbox
 */
export function publishTestRequested(
  id: string,
  createdAt: Date,
  payload: MailProviderTestRequested,
): OutboxEvent {
  return {
    id,
    clinicId: payload.clinicId,
    type: MAIL_PROVIDER_TEST_REQUESTED,
    payload: {
      clinicId: payload.clinicId,
      providerId: payload.providerId,
      slot: payload.slot,
      providerVersion: payload.providerVersion,
      actorUserId: payload.actorUserId,
    },
    createdAt,
  };
}
