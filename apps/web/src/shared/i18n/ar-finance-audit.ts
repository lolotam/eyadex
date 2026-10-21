/**
 * The fields of the refund (`refund.recorded`) and cash closing (`cash_closing.closed`) audit snapshots
 * (finance F2 slice 5, spec §4.6), and the length of the closing note that sits beside them.
 */
export const arRefundClosingAuditFields = {
  refundNumber: "رقم الاسترداد",
  invoiceNumber: "رقم الفاتورة",
  receiptNumber: "رقم الإيصال",
  method: "طريقة الدفع",
  amountMinor: "المبلغ (بالوحدة الصغرى)",
  cashSeq: "رقم الحركة النقدية",
  source: "مصدر الاسترداد",
  spends: "الأرصدة المصروفة",
  creditId: "رصيد المراجع",
  businessDate: "يوم العمل",
  fromCashSeq: "من بعد الحركة النقدية رقم",
  toCashSeq: "لحد الحركة النقدية رقم",
  expectedMinor: "المتوقع (بالوحدة الصغرى)",
  countedMinor: "المعدود (بالوحدة الصغرى)",
  differenceMinor: "الفرق (بالوحدة الصغرى)",
  previousClosingId: "الإقفال السابق",
  noteLength: "طول الملاحظة",
};
