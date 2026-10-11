// P2-F4: the note search runs on decrypted text in memory (ciphertext is never searched in SQL), so the
// folding lives here. NFD splits the hamza and madda off the alef forms (أ إ آ), off ؤ and ئ, and every
// Latin accent; dropping the combining marks then also drops the Arabic diacritics (harakat, shadda).
const COMBINING_MARKS = /\p{M}/gu;
const TATWEEL = /ـ/g;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/g;
const LETTER_FOLDS: ReadonlyMap<string, string> = new Map([
  ["ٱ", "ا"], // alef wasla → alef
  ["ة", "ه"], // taa marbuta → haa
  ["ى", "ي"], // alef maqsura → yaa
]);
const FOLDED_LETTER = /[ٱةى]/g;

const asciiDigit = (digit: string): string => {
  const code = digit.charCodeAt(0);
  return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
};

/**
 * يوحّد النص للمطابقة (P2-F4): حروف صغيرة، من غير تشكيل ولا تطويل، أشكال الألف ألف، التاء المربوطة هاء،
 * الألف المقصورة ياء، الأرقام الهندية أرقام عادية، والمسافات مسافة واحدة.
 *
 * @param text النص
 * @returns النص الموحّد
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(TATWEEL, "")
    .replace(FOLDED_LETTER, (letter) => LETTER_FOLDS.get(letter) ?? letter)
    .replace(ARABIC_INDIC_DIGIT, asciiDigit)
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * هل النص فيه كل كلمات البحث (بأي ترتيب) بعد التوحيد؟ بحث فاضي ما بيطابقش حاجة.
 *
 * @param haystack النص المفكوك
 * @param needle كلمات البحث
 * @returns `true` لو كل كلمة موجودة
 */
export function matches(haystack: string, needle: string): boolean {
  const words = normalizeForMatch(needle)
    .split(" ")
    .filter((word) => word !== "");
  if (words.length === 0) return false;
  const text = normalizeForMatch(haystack);
  return words.every((word) => text.includes(word));
}
