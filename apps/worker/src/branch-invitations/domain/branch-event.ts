import { z } from "zod";

/** الحدث اللي الـ API بيكتبه مع كل تعطيل فرع ناجح (ADR-0013 §12). */
export const BRANCH_DEACTIVATED = "clinic.branch_deactivated";

const schema = z
  .object({
    clinicId: z.string().uuid(),
    branchId: z.string().uuid(),
    actorUserId: z.string().uuid(),
    deactivatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

/** payload حدث تعطيل الفرع بعد التحقق. */
export type BranchDeactivatedEvent = z.output<typeof schema>;

/**
 * يتحقق من payload الحدث ومن إن عيادته هي عيادة صف الـ outbox.
 *
 * @param payload الـ payload كما هو في الصف
 * @param eventClinicId `outbox_events.clinic_id`
 * @returns الحدث، أو `null` لو بايظ أو لعيادة تانية (فشل فوري، مفيش retry يصلّحه)
 */
export function parseBranchDeactivated(
  payload: unknown,
  eventClinicId: string | null,
): BranchDeactivatedEvent | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success || parsed.data.clinicId !== eventClinicId) return null;
  return parsed.data;
}
