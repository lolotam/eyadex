/** سلم الإعادة: 1 ثم 5 ثم 30 ثم 120 دقيقة. مفيش خانة 360. */
export const EXPORT_BACKOFF_MINUTES = [1, 5, 30, 120] as const;

/** أقصى محاولات لصف واحد. المحاولة الجديدة تحتاج `attempt < 5`. */
export const EXPORT_ATTEMPT_LIMIT = 5;

/** مدة التأجير بالثواني. الساعة ساعة القاعدة، مش ساعة الـ worker. */
export const EXPORT_LEASE_SECONDS = 60;

/** تأجيل التصادم على فهرس الجاري الواحد، بالثواني. */
export const MEMBER_BUSY_DEFER_SECONDS = 30;

/** الفهرس الجزئي الوحيد اللي الالتقاط يبتلعه. أي قيد تاني يعدّي. */
export const ONE_RUNNING_INDEX = "finance_report_exports_one_running_idx";

const KINDS = [
  "forbidden",
  "export_amount_too_large",
  "build_failed",
  "store_unavailable",
  "db_error",
  "lease_lost",
  "attempts_exhausted",
] as const;

/** أنواع فشل التصدير في spec §5. */
export type ExportFailureKind = (typeof KINDS)[number];

const FINAL: ReadonlySet<string> = new Set([
  "forbidden",
  "export_amount_too_large",
  "attempts_exhausted",
]);

/**
 * هل النوع نهائي من أول مرة.
 *
 * @param kind نوع الفشل
 * @returns `true` للأنواع اللي إعادة المحاولة مش هتغيّر نتيجتها
 */
export function isFinalFailure(kind: ExportFailureKind): boolean {
  return FINAL.has(kind);
}

/**
 * هل النص نوع فشل معروف. الأنواع التانية مش بتتكتب على الصف.
 *
 * @param value النص كما وصل
 * @returns تضييق النوع
 */
export function isExportFailureKind(value: string): value is ExportFailureKind {
  return (KINDS as readonly string[]).includes(value);
}

/** نتيجة كتابة الفشل: نهائي، أو إعادة بعد دقائق السلم. */
export interface FailureOutcome {
  readonly final: boolean;
  readonly errorCode: ExportFailureKind;
  readonly backoffMinutes: number | null;
}

/**
 * قرار الفشل. الفشل الخامس نهائي بنفس الكود، من غير ما يتبدّل لـ `attempts_exhausted`.
 *
 * @param attempt رقم المحاولة الحالي بعد التأجير
 * @param kind نوع الفشل
 * @returns النهائي أو دقائق الانتظار
 */
export function failureOutcome(attempt: number, kind: ExportFailureKind): FailureOutcome {
  const minutes = EXPORT_BACKOFF_MINUTES[attempt - 1];
  if (isFinalFailure(kind) || attempt >= EXPORT_ATTEMPT_LIMIT || minutes === undefined) {
    return { final: true, errorCode: kind, backoffMinutes: null };
  }
  return { final: false, errorCode: kind, backoffMinutes: minutes };
}

/**
 * مهلة ترك المحاولة. الترك الخامس يسيب الصف `queued` عند الحد من غير مستقبل.
 *
 * @param attempt رقم المحاولة الحالي
 * @returns الدقائق، أو `null` عند الحد
 */
export function abandonBackoffMinutes(attempt: number): number | null {
  if (attempt >= EXPORT_ATTEMPT_LIMIT) return null;
  return EXPORT_BACKOFF_MINUTES[attempt - 1] ?? null;
}

/**
 * هل صف بهذا العدد يقدر يبدأ محاولة جديدة.
 *
 * @param attempt العدد الحالي قبل الزيادة
 * @returns `true` لو أقل من 5
 */
export function canStartAttempt(attempt: number): boolean {
  return Number.isSafeInteger(attempt) && attempt >= 0 && attempt < EXPORT_ATTEMPT_LIMIT;
}

/**
 * تصادم فهرس الجاري الواحد بس. أي SQLSTATE أو قيد تاني مش تصادم عضو.
 *
 * @param error شكل خطأ القاعدة بعد التنضيف
 * @returns `true` لو ده القيد الوحيد المبتلع
 */
export function isOneRunningCollision(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const shaped = error as { readonly code?: unknown; readonly constraint?: unknown };
  return shaped.code === "23505" && shaped.constraint === ONE_RUNNING_INDEX;
}

/**
 * النبض يمدّد تأجيرًا جاريًا وحيًا وملك المحاولة فقط.
 *
 * @param input حالة الصف بعد القفل
 * @returns `true` لو التمديد مسموح
 */
export function heartbeatMayRenew(input: {
  readonly status: string;
  readonly leaseLive: boolean;
  readonly attemptMatches: boolean;
  readonly ownerMatches: boolean;
}): boolean {
  return (
    input.status === "running" && input.leaseLive && input.attemptMatches && input.ownerMatches
  );
}

/**
 * إعادة القراءة بعد كتابة صفر صفوف. النجاح المفقود بس يحتفظ بالملف.
 *
 * @param input حالة التصدير وصف الـ blob بتاع نفس المحاولة
 * @returns `own_success` أو `lost_lease`
 */
export function rereadVerdict(input: {
  readonly status: string;
  readonly storageKey: string | null;
  readonly ownKey: string;
  readonly blobState: string | null;
  readonly blobKey: string | null;
}): "own_success" | "lost_lease" {
  if (
    input.status === "done" &&
    input.storageKey === input.ownKey &&
    input.blobState === "published" &&
    input.blobKey === input.ownKey
  ) {
    return "own_success";
  }
  return "lost_lease";
}
