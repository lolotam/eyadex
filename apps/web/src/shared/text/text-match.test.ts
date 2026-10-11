import { describe, expect, it } from "vitest";
import { matches, normalizeForMatch } from "./text-match";

// The cases of the API's `domain/__tests__/text-match.spec.ts`: the copy must fold and match the same.
describe("normalizeForMatch", () => {
  it.each([
    ["every alef form to a bare alef", "أإآٱا", "ااااا"],
    ["taa marbuta to haa, alef maqsura to yaa", "حمّة مستشفى", "حمه مستشفي"],
    ["no harakat, shadda or tatweel", "القَلَقُ الشّـديد", "القلق الشديد"],
    [
      "Latin case and accents, Arabic-Indic digits, runs of spaces",
      "  Café   NAUSÉE ٣٨ ۵ ",
      "cafe nausee 38 5",
    ],
  ])("folds %s", (_case, text, folded) => {
    expect(normalizeForMatch(text)).toBe(normalizeForMatch(folded));
    expect(normalizeForMatch(folded)).toBe(folded);
  });
});

describe("matches", () => {
  it.each([
    ["a plain word inside a diacritised phrase", "القَلَق الشديد", "قلق", true],
    ["across alef forms", "ألم في الرأس", "الم", true],
    ["across alef maqsura and yaa", "صداع بسيط مع حمى", "حمي", true],
    ["across Latin case", "Migraine with aura", "MIGRAINE", true],
    ["every word, in any order", "ضغط مرتفع وصداع", "صداع ضغط", true],
    ["not when one word is missing", "ضغط مرتفع", "صداع ضغط", false],
    ["nothing for a query empty after folding", "أي نص", "َ ـ ", false],
  ])("%s", (_case, haystack, needle, expected) => {
    expect(matches(haystack, needle)).toBe(expected);
  });
});
