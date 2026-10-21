import type { ClinicIdempotencyKey } from "../../../../shared/clinic-idempotency.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";

/** عمليات الفلوس اللي بتتعمل على فاتورة، ونطاق مفتاح كل واحدة (spec §4.4). */
const SCOPES = {
  "payment.create": "payment:create",
  "credit.apply": "credit:apply",
  "refund.create": "refund:create",
} as const;

/**
 * حجز مفتاح عملية فلوس على فاتورة (spec §4.4، §8d R3-6): النطاق = العملية + الفاعل، والبصمة بتغطي
 * العملية والفاتورة اللي في المسار والجسم. فالمفتاح والجسم نفسهم على فاتورة تانية = تعارض، مش إعادة.
 *
 * @param actor الفاعل
 * @param operation اسم العملية
 * @param invoiceId الفاتورة في المسار
 * @param body جسم الطلب
 * @param key قيمة `Idempotency-Key`
 * @returns الحجز
 */
export function moneyClaim(
  actor: BillingActor,
  operation: keyof typeof SCOPES,
  invoiceId: string,
  body: unknown,
  key: string,
): ClinicIdempotencyKey {
  return {
    clinicId: actor.clinicId,
    scope: `${SCOPES[operation]}:${actor.userId}`,
    key,
    hash: requestHash({ operation, invoiceId, body }),
  };
}

/**
 * حجز مفتاح إقفال الصندوق (spec §4.4): النطاق `cash_closing:create` + الفاعل، والبصمة بتغطي العملية
 * والجسم، والفرع جوه الجسم، فالمفتاح والجسم نفسهم على فرع تاني = تعارض.
 *
 * @param actor الفاعل
 * @param body جسم الطلب
 * @param key قيمة `Idempotency-Key`
 * @returns الحجز
 */
export function closingClaim(
  actor: BillingActor,
  body: unknown,
  key: string,
): ClinicIdempotencyKey {
  return {
    clinicId: actor.clinicId,
    scope: `cash_closing:create:${actor.userId}`,
    key,
    hash: requestHash({ operation: "cash_closing.create", body }),
  };
}
