import type { RetentionTarget } from "@eyadex/db";

/**
 * الدفاتر بالترتيب اللي بتتنضف بيه. مدد الاحتفاظ نفسها (30 / 30 / 90 يوم) مكانها الوحيد هو db/sql/0040
 * و ADR-0022: الداتابيز هي اللي بتحسب الحد، فمفيش رقم هنا ممكن يختلف عنها.
 */
export const RETENTION_TARGETS: readonly RetentionTarget[] = [
  "outbox",
  "platformLedger",
  "clinicLedger",
];

/** صفوف في الدفعة: transaction قصيرة، وتحت سقف الـ function (1000). */
export const PURGE_BATCH_SIZE = 500;

/**
 * دفعات لكل دفتر في التشغيل الواحد. لو الدفتر لسه فيه أكتر، التشغيل الجاي بيكمل، فأول تشغيل بعد
 * النشر على داتابيز متراكمة مابيمسكش الـ worker أكتر من 20 دفعة لكل دفتر.
 */
export const MAX_BATCHES_PER_RUN = 20;
