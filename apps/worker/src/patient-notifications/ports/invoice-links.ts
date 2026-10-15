import type { SecretSealer } from "@eyadex/secrets";

/** نتيجة خطوة الرابط (C1، Tx 1) قبل أي إرسال. */
export type PreparedInvoiceLink =
  /** الصف مش رسالة فاتورة في الطابور (نوع تاني، أو اتبعت، أو مش موجود): المسار العادي بيقرر. */
  | { readonly kind: "not_invoice" }
  /** الفاتورة اتلغت قبل الإرسال: الصف اتكتب `skipped`/`invoice_void` ومفيش رابط اتعمل. */
  | { readonly kind: "void" }
  /** مفيش `INVOICE_LINK_SEAL_KEY`: الصف بيفضل `queued` ومفيش رابط اتعمل. */
  | { readonly kind: "no_key" }
  /** رابط حي للرسالة دي، اتعمل commit قبل الإرسال؛ الرمز في ذاكرة الـ worker بس. */
  | { readonly kind: "ready"; readonly token: string };

/** رابط الفاتورة على pool الـ `eyadex_app` تحت `withTenant` (0062، RLS). */
export interface InvoiceLinkStore {
  /**
   * Tx 1 (C1-Q3): بيمسك صف الرسالة `FOR UPDATE`، ولو رسالة فاتورة في الطابور بيقرا الفاتورة `FOR SHARE`
   * (قبل `invoice_links`، نفس ترتيب الإلغاء)، وبعدين الرابط الحي `FOR UPDATE`: لو بيتفتح وبيطابق الـ hash
   * بيرجع نفس الرمز، ولو ختمه مابيتفتحش (المفتاح اتغير) أو انتهى بيتقفل ويتعمل رابط جديد، ولو مفيش
   * بيتعمل. الـ transaction بتخلص قبل أي إرسال.
   *
   * @param clinicId عيادة الحدث
   * @param notificationId صف الرسالة
   * @param sealer ختم `INVOICE_LINK_SEAL_KEY`، أو `null` لو المفتاح مش مضبوط
   * @param now الوقت (الانتهاء بيتحسب منه)
   * @returns القرار
   */
  prepare(
    clinicId: string,
    notificationId: string,
    sealer: SecretSealer | null,
    now: Date,
  ): Promise<PreparedInvoiceLink>;
}
