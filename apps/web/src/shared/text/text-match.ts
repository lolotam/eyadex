// A copy of the API's `apps/api/src/modules/medical/domain/text-match.ts` (P2-F4), so the mock searches
// exactly as the API does; change both together (`text-match.test.ts` runs the API spec's cases).
// NFD splits the hamza and madda off the alef forms (أ إ آ), off ؤ and ئ, and every Latin accent;
// dropping the combining marks then also drops the Arabic diacritics (harakat, shadda).
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
 * Text folded for matching: lower case, no diacritics or tatweel, every alef form a bare alef, taa
 * marbuta as haa, alef maqsura as yaa, Arabic-Indic digits as ASCII, runs of spaces as one.
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
 * Does the text hold every word of the query, in any order, once both are folded? An empty query
 * never matches.
 */
export function matches(haystack: string, needle: string): boolean {
  const words = normalizeForMatch(needle)
    .split(" ")
    .filter((word) => word !== "");
  if (words.length === 0) return false;
  const text = normalizeForMatch(haystack);
  return words.every((word) => text.includes(word));
}
