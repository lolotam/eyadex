import assert from "node:assert/strict";
import { completePage } from "./complete-text.mjs";
import { ordered } from "./structure.mjs";

export function completeTextGuards() {
  const words = { a: "Invoice", b: "12.500" };
  const ids = ["a", "b"];
  const literals = [{ anchor: "b", value: "/" }];
  const check = (text) => completePage(text, ids, words, literals, 1, 1);
  check("Invoice 12.500 / 1 / 1");
  for (const text of [
    "Invoice Invoice 12.500 / 1 / 1",
    "stale Invoice 12.500 / 1 / 1",
    "Invoice 12.500 / 1 / 1 stale",
    "Invoice 12.500 / 1",
    "Invoice 12.500 // 1 / 1",
  ]) {
    assert.throws(() => check(text), /unexpected or missing page text/);
  }
  // The previous subsequence-only check accepts extra text around valid fields.
  assert.doesNotThrow(() => ordered("stale Invoice 12.500 stale", Object.values(words)));
  return { duplicatedExtraMissingPageTextRejected: true };
}
