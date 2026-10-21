import type { ClinicIdempotencyKey } from "../../../../shared/clinic-idempotency.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";

/**
 * حجز مفتاح عملية فلوس (spec §4.4، §8d R3-6): النطاق = العملية + الفاعل، والبصمة بتغطي العملية
 * والفاتورة اللي في المسار والجسم. فالمفتاح والجسم نفسهم على فاتورة تانية = تعارض، مش إعادة.
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
  operation: "payment.create" | "credit.apply",
  invoiceId: string,
  body: unknown,
  key: string,
): ClinicIdempotencyKey {
  const scope = operation === "payment.create" ? "payment:create" : "credit:apply";
  return {
    clinicId: actor.clinicId,
    scope: `${scope}:${actor.userId}`,
    key,
    hash: requestHash({ operation, invoiceId, body }),
  };
}
