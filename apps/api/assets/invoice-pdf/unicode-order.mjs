import assert from "node:assert/strict";

// Separate empirical encodings for the pinned extractors: pdf.js uses ToUnicode,
// while Poppler uses the outer ActualText span. These invisible marks affect only
// extraction; the Type 3 character procedures replay the original Typst drawing.
export function extractionSequences(word) {
  assert(!/[\p{Cf}\p{Cc}]/u.test(word), "unsupported_format_character");
  assert.match(
    word,
    /^(?:\p{Script_Extensions=Arabic}|\p{Script_Extensions=Latin}|\p{N}|\p{P}|\p{Sc}|\p{Sm})+$/u,
    "unsupported_script",
  );
  // The pinned extractor normalizes compatibility Latin ligatures and removes
  // angle brackets in its Arabic bidi path. Refuse, never silently lose text.
  assert(!/[\ufb00-\ufb06]/u.test(word), "unsupported_compatibility_ligature");
  if (!/(?=\p{Script=Arabic})\p{L}/u.test(word)) return { points: [...word], actual: word };
  assert(!/[<>]/u.test(word), "unsupported_mixed_angle_bracket");
  // Three LRM characters per source point keep pdf.js 6.3.289's inferred base
  // direction LTR (its threshold is 30%), and isolate each logical source point.
  // A glyph must end in the source point: pdf.js drops a glyph ending in Cf.
  // Poppler needs LRM on both sides instead. CI strips only injected bidi marks;
  // original marks, punctuation, digits and their order must remain exact.
  return {
    points: [...word].map((point) => "\u200e\u200e\u200e" + point),
    actual: [...word].map((point) => "\u200e" + point + "\u200e").join(""),
  };
}
