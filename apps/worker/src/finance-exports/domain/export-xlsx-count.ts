/**
 * يحفظ العداد كاملًا: Excel يضمن 15 خانة رقمية فقط، وما بعدها يتكتب نصًا بلا سقف أعمال.
 * @param value العداد غير السالب بعد التحقق من شكله
 * @returns رقم دقيق حتى 15 خانة أو نص عشري دقيق للأعداد الأكبر
 */
export function xlsxCountValue(value: bigint): number | string {
  return value <= 999_999_999_999_999n ? Number(value) : value.toString();
}
