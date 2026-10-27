import type { FrozenReportExportParams } from "@eyadex/contracts/finance-reports-export";
import type { ReportExportFormat, ReportId } from "@eyadex/contracts/finance-reports";
import type { PermissionScope } from "@eyadex/contracts/permissions";

import type { ExportFailureKind } from "../domain/export-failures.ts";

/** سياج الكتابة: العيادة والتصدير والمحاولة والمالك. */
export interface ExportFence {
  readonly clinicId: string;
  readonly exportId: string;
  readonly attempt: number;
  readonly leaseOwner: string;
}

/** قرار جدول الالتقاط. التأجير ملتزم قبل الرجوع. */
export type ClaimDecision =
  | { readonly kind: "dispatched" }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "deferred"; readonly nextAttemptAt: Date }
  | { readonly kind: "leased"; readonly attempt: number; readonly leaseUntil: Date };

/**
 * لقطة الطلب المجمّدة لتأجير جاري ومملوك وحي. مش تفويض حالي:
 * `scope` سقف مخزّن مش منحة، و`params` كائن JSON غير متحقّق.
 */
export interface LeasedExportJob {
  readonly requestedBy: string;
  readonly report: ReportId;
  readonly format: ReportExportFormat;
  readonly scope: PermissionScope;
  readonly params: unknown;
}

/**
 * الطلب بعد إعادة التفويض. الخمسة حقول المجمّدة، و`params` متفسّرة، و`userId` من العضوية الحالية.
 * `scope` السقف المخزّن مش النطاق الأوسع. مفيش مفاتيح ولا أسماء ولا مرضى ولا تأجير.
 */
export interface PreparedExportJob {
  readonly requestedBy: string;
  readonly report: ReportId;
  readonly format: ReportExportFormat;
  readonly scope: PermissionScope;
  readonly params: FrozenReportExportParams;
  readonly userId: string;
}

/** تجهيز قراءة لاحقة: جاهز، أو التأجير ضاع، أو التفويض سقط، أو الـ params فاسدة. */
export type PrepareExportAnswer =
  | { readonly kind: "ready"; readonly job: PreparedExportJob }
  | { readonly kind: "lost_lease" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "invalid_params" };

/** كتابة مسوّرة: اتطبقت، أو إعادة القراءة قالت نجاح المحاولة، أو التأجير ضاع. */
export type FenceAnswer =
  { readonly kind: "applied" } | { readonly kind: "own_success" } | { readonly kind: "lost_lease" };

/** رفض قبل أي كتابة. الصف والتدقيق ما بيتغيّروش. */
export type PublishRefusal =
  "missing_patient_set" | "actor_unresolved" | "params_incomplete" | "invalid_size";

/** نتيجة النشر المسوّر. مفيش حذف هنا. */
export type PublishAnswer =
  | { readonly kind: "published" }
  | { readonly kind: "own_success" }
  | { readonly kind: "lost_lease" }
  | { readonly kind: "refused"; readonly reason: PublishRefusal };

/**
 * التقاط التأجير بس. الـ handler ما يشوفش النشر ولا الـ blob.
 */
export interface ExportClaimPort {
  /**
   * يقرأ الصف تحت `FOR UPDATE` ويطبّق جدول القرار في معاملة تطبيق قصيرة.
   *
   * @param input العيادة والتصدير ومالك التأجير
   * @returns القرار بعد التزام الكتابة، إن وجدت
   */
  decideClaim(input: {
    readonly clinicId: string;
    readonly exportId: string;
    readonly leaseOwner: string;
  }): Promise<ClaimDecision>;
}

/**
 * مخزن التصدير على `eyadex_app`. كل كتابة تقفل الصف الأول وتستخدم `clock_timestamp()`.
 */
export interface ExportStore extends ExportClaimPort {
  /**
   * يمدّد تأجيرًا جاريًا وحيًا. المنتهي أو النهائي ما يتجدّدش.
   *
   * @param fence سياج المحاولة
   * @returns التمديد أو إعادة القراءة
   */
  heartbeat(fence: ExportFence): Promise<FenceAnswer>;
  /**
   * يكتب الفشل ويفك التأجير. مالك جديد ما يتكتبش عليه.
   *
   * @param fence سياج المحاولة
   * @param kind نوع الفشل
   * @returns الكتابة أو إعادة القراءة
   */
  recordFailure(fence: ExportFence, kind: ExportFailureKind): Promise<FenceAnswer>;
  /**
   * يفك التأجير من غير ما يغيّر الحالة. مالك جديد ما يتفكّش.
   *
   * @param fence سياج المحاولة
   * @returns الفك أو إعادة القراءة
   */
  release(fence: ExportFence): Promise<FenceAnswer>;
  /**
   * يرجّع الصف `queued` ويفك التأجير. الترك الخامس يسيب الحد من غير مستقبل.
   *
   * @param fence سياج المحاولة
   * @returns الترك أو إعادة القراءة
   */
  abandon(fence: ExportFence): Promise<FenceAnswer>;
  /**
   * يحجز صف blob قبل الرفع. مفيش شبكة.
   *
   * @param fence سياج المحاولة
   * @returns المفتاح، أو ضياع التأجير
   */
  allocateBlob(
    fence: ExportFence,
  ): Promise<
    | { readonly kind: "allocated"; readonly blobId: string; readonly storageKey: string }
    | { readonly kind: "lost_lease" }
  >;
  /**
   * ينقل blob المحاولة من `allocated` إلى `uploaded`. غير كده رفض من غير حذف.
   *
   * @param fence سياج المحاولة
   * @returns الانتقال أو الرفض
   */
  markUploaded(
    fence: ExportFence,
  ): Promise<{ readonly kind: "uploaded" } | { readonly kind: "refused" }>;
  /**
   * ينشر محاولة واحدة. الـ blob والتدقيق قبل تحديث الصف المسوّر، والتحديث الأخير بعد انتظارهم،
   * عشان ساعة القاعدة تشوف نهاية التأجير. غير كده المعاملة تتراجع.
   *
   * @param fence سياج المحاولة
   * @param input الحجم والعدد ومجموعة مرضى `own`
   * @returns النشر أو إعادة القراءة أو رفض قبل الكتابة
   */
  publish(
    fence: ExportFence,
    input: {
      readonly byteSize: number;
      readonly rowCount: number;
      readonly patientIds: readonly string[] | null;
    },
  ): Promise<PublishAnswer>;
  /**
   * إعادة القراءة المشتركة بعد صفر صفوف. ما تمسحش ملفًا.
   *
   * @param fence سياج المحاولة
   * @returns نجاح المحاولة أو ضياع التأجير
   */
  reread(fence: ExportFence): Promise<"own_success" | "lost_lease">;
  /**
   * يقرأ الخمسة حقول المجمّدة بعد قفل الصف، وفقط لو التأجير جاري ومملوك وحي.
   * اللقطة مش تفويض: `scope` سقف مش منحة، و`params` ما يتفسّرش ولا يتوسّع هنا.
   *
   * @param fence سياج المحاولة
   * @returns الحقول الخمسة، أو `null` لو الصف مش التأجير الحي المملوك
   */
  readLeasedJob(fence: ExportFence): Promise<LeasedExportJob | null>;
  /**
   * يعيد تفويض التأجير الحي قبل قراءة صفوف التقرير. السياج بس هو المدخل.
   * السقف المخزّن ما يتوسّعش، ومفيش كتابة ولا تجديد.
   *
   * @param fence سياج المحاولة
   * @returns الجاهز أو سبب التوقف
   */
  prepareLeasedJob(fence: ExportFence): Promise<PrepareExportAnswer>;
}
