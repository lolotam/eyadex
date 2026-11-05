import assert from "node:assert/strict";
import { compatibleGlyphText } from "./glyph-text.mjs";

// Synthetic font objects reproduce the fail-open association without patient data.
export function glyphGuardTests() {
  const objects = {
    "obj:1 0 R": { value: { "/Font": { "/F1": "2 0 R" } } },
    "obj:2 0 R": { value: { "/ToUnicode": "3 0 R" } },
    "obj:3 0 R": { stream: { data: "" } },
  };
  const page = { "/Resources": "1 0 R" };
  const use = (mapping, body, word = "AB") => {
    objects["obj:3 0 R"].stream.data = Buffer.from(mapping).toString("base64");
    return compatibleGlyphText("/F1 12 Tf " + body, word, objects, page);
  };
  const mapped = "2 beginbfchar <0001> <0041> <0002> <0042> endbfchar";
  assert.equal(use(mapped, "<0001> Tj", "A"), true);
  assert.equal(use(mapped, "<00010002> Tj"), true);
  assert.equal(use(mapped, "<0001> Tj <0002> Tj"), true);
  assert.equal(use(mapped, "(\\000\\001) Tj", "A"), true);
  for (const body of [
    "<0003> Tj",
    "<00010003> Tj",
    "<> Tj",
    "<00> Tj",
    "<00> Tj <01> Tj",
    "(A) Tj (B) Tj",
    "<0001",
    "<xx> Tj",
    "(\\000\\001",
    "(\\",
  ])
    assert.equal(use(mapped, body), false, "unknown or malformed glyph text must be rejected");
  assert.equal(use("1 beginbfrange <0001> <0002> <0041> endbfrange", "<0001> Tj"), false);
  assert.equal(use("1 beginbfchar <0001> <> endbfchar", "<0001> Tj"), false);
  assert.equal(use("2 beginbfchar <0001> <0041> <0002> <> endbfchar", "<00010002> Tj"), false);
  return { unknownAndPartialCodesRejected: true, malformedTextRejected: true };
}
