/**
 * الفلوس بتتجمع كأعداد صحيحة كبيرة عشان دقة الوحدات الصغرى ما تضيعش.
 * @param rows الصفوف المطلوبة
 * @param key عمود المبلغ
 * @returns المجموع كنص عشري
 */
export function sumReportMoney<T, K extends keyof T>(rows: readonly T[], key: K): string {
  return rows.reduce((sum, row) => sum + BigInt(String(row[key])), 0n).toString();
}

/**
 * سطر الضريبة جزء من الإجمالي، لكن مش من إيراد البنود ولا عددها.
 * @param rows صفوف تحليل الإيراد ومعاها سطر الضريبة
 * @returns إجماليات التقرير
 */
export function analyticsTotals(
  rows: readonly { kind: string; lineCount: number; quantity: number; amountMinor: string }[],
) {
  return {
    lineCount: rows.reduce((sum, row) => sum + row.lineCount, 0),
    quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    billedMinor: sumReportMoney(
      rows.filter((row) => row.kind !== "tax"),
      "amountMinor",
    ),
    taxMinor: sumReportMoney(
      rows.filter((row) => row.kind === "tax"),
      "amountMinor",
    ),
    totalMinor: sumReportMoney(rows, "amountMinor"),
  };
}
