import { describe, expect, it } from "vitest";

import { matches, normalizeForMatch } from "../text-match.ts";

// P2-F4 (spec §3): the per-patient note search folds Arabic letter forms and diacritics, and Latin case.
describe("normalizeForMatch", () => {
  it("folds every alef form to a bare alef", () => {
    expect(normalizeForMatch("أإآٱا")).toBe("ااااا");
  });

  it("folds taa marbuta to haa and alef maqsura to yaa", () => {
    expect(normalizeForMatch("حمّة مستشفى")).toBe(normalizeForMatch("حمه مستشفي"));
  });

  it("drops harakat, shadda and tatweel", () => {
    expect(normalizeForMatch("القَلَقُ الشّـديد")).toBe("القلق الشديد");
  });

  it("folds Latin case and accents, Arabic-Indic digits and runs of spaces", () => {
    expect(normalizeForMatch("  Café   NAUSÉE ٣٨ ۵ ")).toBe("cafe nausee 38 5");
  });
});

describe("matches", () => {
  it("finds a plain word inside a diacritised phrase (the plan's example)", () => {
    expect(matches("القَلَق الشديد", "قلق")).toBe(true);
  });

  it("matches across letter forms in either direction", () => {
    expect(matches("ألم في الرأس", "الم")).toBe(true);
    expect(matches("صداع بسيط مع حمى", "حمي")).toBe(true);
    expect(matches("Migraine with aura", "MIGRAINE")).toBe(true);
  });

  it("needs every word of the query, in any order", () => {
    expect(matches("ضغط مرتفع وصداع", "صداع ضغط")).toBe(true);
    expect(matches("ضغط مرتفع", "صداع ضغط")).toBe(false);
  });

  it("an empty query (after folding) matches nothing", () => {
    expect(matches("أي نص", "َ ـ ")).toBe(false);
  });
});
