import assert from "node:assert/strict";

const tokens = (text) =>
  (
    text
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
      .match(/[\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}\s]/gu) ?? []
  ).sort();

// Complete inventory complements, rather than replaces, source-order checks.
export function completePage(text, ids, words, page, pageCount) {
  const present = new Set(ids);
  const expected = [
    ...[...present].map((id) => words[id]),
    String(page),
    "/",
    String(pageCount),
  ].join(" ");
  assert.deepEqual(tokens(text), tokens(expected), "unexpected or missing page text");
}
