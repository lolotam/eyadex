/** إصدار ICD-10-CM اللي اللودر بيحمّله ورد البحث بيذكره (P2-F1). */
export const ICD10_RELEASE = "FY2027";

/** سطر من جدول `icd10_codes`. */
export interface Icd10Row {
  readonly code: string;
  readonly titleEn: string;
  readonly billable: boolean;
}

// The CDC order file (icd10cm-order-<year>.txt) is fixed width: order number (5), space, code (7, padded),
// space, billable flag (1), space, short title (60, padded), space, long title.
const CODE_START = 6;
const CODE_END = 13;
const FLAG_AT = 14;
const SHORT_START = 16;
const SHORT_END = 76;
const LONG_START = 77;
const RAW_CODE = /^[A-Z][0-9][0-9A-Z][0-9A-Z]{0,4}$/;

/**
 * R2-8: الكود زي ما ICD-10-CM بيكتبه: النقطة بعد التالت حرف لما الكود أطول من تلاتة بس (`F41` تفضل،
 * `F411` تبقى `F41.1`).
 *
 * @param raw الكود من غير نقطة زي ملف CDC
 * @returns الكود بالنقطة
 */
export function dottedCode(raw: string): string {
  return raw.length > 3 ? `${raw.slice(0, 3)}.${raw.slice(3)}` : raw;
}

/**
 * R2-8: يقرا ملف الترتيب بتاع CDC سطر سطر. سطور العناوين (العلامة `0`) بتفضل في الجدول بـ
 * `billable = false`؛ العنوان الطويل هو اللي بيتخزّن (والقصير لو الطويل فاضي). سطر مش على الشكل ده
 * بيوقف القراية برقم السطر.
 *
 * @param text محتوى الملف
 * @returns الصفوف بالترتيب
 */
export function parseIcd10OrderFile(text: string): Icd10Row[] {
  const rows: Icd10Row[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return;
    const raw = line.slice(CODE_START, CODE_END).trim();
    const flag = line.charAt(FLAG_AT);
    const title = line.slice(LONG_START).trim() || line.slice(SHORT_START, SHORT_END).trim();
    if (!RAW_CODE.test(raw) || (flag !== "0" && flag !== "1") || title === "") {
      throw new RangeError(`icd10: line ${index + 1} is not an order-file row`);
    }
    rows.push({ code: dottedCode(raw), titleEn: title, billable: flag === "1" });
  });
  return rows;
}

/** كلمات البحث: بادئة كود (لو الكلمة شكلها كود) وكلمات العنوان. */
export interface Icd10Terms {
  /** البادئة بحروف كبيرة ومن غير نقطة، أو `null` لو الكلمة مش شكل كود. */
  readonly codePrefix: string | null;
  /** كلمات العنوان بحروف صغيرة؛ كلها لازم تكون في العنوان. */
  readonly words: readonly string[];
}

const CODE_LIKE = /^[A-Za-z][0-9][0-9A-Za-z.]*$/;

/**
 * يفصل كلمة البحث (P2-F1): كلمة واحدة شكلها كود بتدوّر بالبادئة (`f41`، `F41.1`، `F411`)، وكل
 * الكلمات بتدوّر في العنوان.
 *
 * @param q الكلمة بعد `icd10QuerySchema`
 * @returns البادئة والكلمات
 */
export function icd10Terms(q: string): Icd10Terms {
  const trimmed = q.trim();
  return {
    codePrefix: CODE_LIKE.test(trimmed) ? trimmed.toUpperCase().replaceAll(".", "") : null,
    words: trimmed.toLowerCase().split(/\s+/).filter(Boolean),
  };
}
