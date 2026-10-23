import type { FINANCE_F2_ERROR_CODES, FINANCE_F3_ERROR_CODES } from "@eyadex/contracts/common";

/** Keeps the F2 and F3 messages exhaustive without growing the shared API catalogue beyond its file limit. */
export const FINANCE_ERROR_MESSAGES = {
  payment_method_disabled: {
    message_ar: "طريقة الدفع دي مقفولة في إعدادات العيادة.",
    message_en: "This payment method is turned off in the clinic settings.",
  },
  payment_exceeds_balance: {
    message_ar: "المبلغ أكبر من المتبقي على الفاتورة.",
    message_en: "The amount is more than the invoice still owes.",
  },
  invoice_settled: {
    message_ar: "الفاتورة مدفوعة بالكامل.",
    message_en: "The invoice is already fully paid.",
  },
  credit_insufficient: {
    message_ar: "رصيد المراجع أقل من المبلغ المطلوب.",
    message_en: "The patient's credit is less than the amount.",
  },
  refund_exceeds_available: {
    message_ar: "المبلغ أكبر من المتاح للاسترداد.",
    message_en: "The amount is more than can be refunded.",
  },
  payment_methods_empty: {
    message_ar: "لازم طريقة دفع واحدة على الأقل تفضل شغالة.",
    message_en: "At least one payment method must stay on.",
  },
  cash_drawer_changed: {
    message_ar: "فيه حركة نقدية جديدة من وقت المعاينة. راجع الإقفال تاني.",
    message_en: "Cash moved since the preview. Review the closing again.",
  },
  invoice_paid_changed: {
    message_ar:
      "المبلغ المدفوع على هذه الفاتورة تغيّر بعد آخر قراءة لها؛ راجع الحركات ثم أعد المحاولة",
    message_en:
      "The paid amount on this invoice changed since you last read it; check the movements and try again.",
  },
  cash_closing_exists: {
    message_ar: "الفرع ده اتقفل صندوقه النهارده.",
    message_en: "This branch's cash is already closed for today.",
  },
  closing_note_required: {
    message_ar: "اكتب ملاحظة لما يكون فيه فرق.",
    message_en: "Write a note when there is a difference.",
  },
  cash_drawer_out_of_range: {
    message_ar: "صافي النقد في الفترة دي أكبر من الحد المسموح، ومينفعش يتقفل.",
    message_en: "The period's net cash is beyond the allowed limit and cannot be closed.",
  },
  export_busy: {
    message_ar: "فيه تصدير شغال دلوقتي؛ استنى لحد ما يخلص.",
    message_en: "Another export is already running; wait for it to finish.",
  },
  report_range_too_long: {
    message_ar: "الفترة المطلوبة أطول من المسموح.",
    message_en: "The period is longer than allowed.",
  },
  export_amount_too_large: {
    message_ar: "المبلغ أكبر من دقة ملف CSV؛ صدّر Excel بدل CSV.",
    message_en: "The amount is too large for a CSV file; export an XLSX instead.",
  },
} satisfies Record<
  (typeof FINANCE_F2_ERROR_CODES)[number] | (typeof FINANCE_F3_ERROR_CODES)[number],
  { message_ar: string; message_en: string }
>;
