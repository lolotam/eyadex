import type { FINANCE_F2_ERROR_CODES } from "@eyadex/contracts/common";

/** Keeps F2 messages exhaustive without growing the shared API catalogue beyond its file limit. */
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
} satisfies Record<
  (typeof FINANCE_F2_ERROR_CODES)[number],
  { message_ar: string; message_en: string }
>;
