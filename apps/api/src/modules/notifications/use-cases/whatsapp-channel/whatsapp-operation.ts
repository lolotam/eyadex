import type { ChannelRecord, ChannelRefusal } from "../../domain/whatsapp-rules.ts";
import {
  findWhatsappChannel,
  lockWhatsappChannel,
  saveWhatsappChannel,
} from "../../persistence/pg-whatsapp-channel.ts";
import { emptyChannel, refuse, type WhatsappDeps } from "./whatsapp-shared.ts";
import {
  requireWhatsappOperationFree,
  reserveWhatsappOperation,
  releaseWhatsappOperation,
} from "../../persistence/pg-whatsapp-operation.ts";

/**
 * يحجز تعديل الربط بين المعاملتين، من غير قفل قاعدة بيانات وقت الشبكة. طلب متزامن يُعاد لاحقًا؛
 * الحجز ينتهي تلقائيًا لو العملية توقفت، والإرسال ينتظر انتهاء تعديل الـ instance.
 *
 * @param deps قاعدة البيانات والساعة ومولد المعرفات
 * @param clinicId العيادة
 * @param validate قرار الرفض قبل حجز أول صف
 * @param run عملية الربط
 * @returns نتيجة العملية
 */
export async function withWhatsappOperation<T>(
  deps: WhatsappDeps,
  clinicId: string,
  validate: (record: ChannelRecord | null) => ChannelRefusal | null,
  run: () => Promise<T>,
): Promise<T> {
  const id = deps.ids.newId();
  await deps.db.withTenant(clinicId, async (tx) => {
    await lockWhatsappChannel(tx, clinicId);
    const before = await findWhatsappChannel(tx, clinicId);
    const now = deps.clock.now();
    await requireWhatsappOperationFree(tx, clinicId, now);
    refuse(validate(before));
    if (before === null)
      await saveWhatsappChannel(tx, clinicId, emptyChannel(deps.ids.newId()), now);
    await reserveWhatsappOperation(tx, clinicId, id, now);
  });
  try {
    return await run();
  } finally {
    await deps.db.withTenant(clinicId, async (tx) => {
      await releaseWhatsappOperation(tx, clinicId, id);
    });
  }
}
