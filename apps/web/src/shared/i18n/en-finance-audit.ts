/**
 * The fields of the refund (`refund.recorded`) and cash closing (`cash_closing.closed`) audit snapshots
 * (finance F2 slice 5, spec §4.6), the refund reason and closing note lengths among them.
 */
export const enRefundClosingAuditFields = {
  refundNumber: "Refund number",
  invoiceNumber: "Invoice number",
  receiptNumber: "Receipt number",
  method: "Payment method",
  amountMinor: "Amount (minor units)",
  cashSeq: "Cash movement number",
  source: "Refund source",
  spends: "Credits spent",
  creditId: "Patient credit",
  businessDate: "Business day",
  fromCashSeq: "After cash movement number",
  toCashSeq: "Through cash movement number",
  expectedMinor: "Expected (minor units)",
  countedMinor: "Counted (minor units)",
  differenceMinor: "Difference (minor units)",
  previousClosingId: "Previous closing",
  reasonLength: "Refund reason length (characters)",
  noteLength: "Note length (characters)",
};
