import assert from "node:assert/strict";
import { compatibleGlyphText } from "./glyph-text.mjs";
import { wordId } from "./word-id.mjs";

// Temporarily expose word links from Typst's running artifacts to the same binder.
// Synthetic MCIDs/nodes are removed again; the original Artifact boundary is retained.
export function prepareArtifacts({
  objects,
  page,
  pageRef,
  text,
  marked,
  graphics,
  parents,
  add,
  words,
}) {
  const originalLength = parents.length,
    nodes = [],
    syntheticIds = new Set(),
    changes = [],
    owned = new Set();
  const groups = new Map();
  for (const reference of page["/Annots"] ?? []) {
    const annotation = objects["obj:" + reference]?.value,
      uri = annotation?.["/A"]?.["/URI"];
    if (annotation?.["/StructParent"] !== undefined || !uri?.startsWith("u:urn:e:")) continue;
    const group = groups.get(uri) ?? [];
    group.push({ reference, annotation });
    groups.set(uri, group);
  }
  for (const [uri, group] of groups) {
    const word = words[wordId(uri)];
    assert(word);
    const parts = graphics.filter((part) => {
      if (marked.some((span) => span.start <= part.start && part.end <= span.end)) return false;
      if (!compatibleGlyphText(part.body, word, objects, page)) return false;
      const [x, y] = part.origin;
      return group.some(({ annotation }) => {
        const [left, bottom, right, top] = annotation["/Rect"];
        return x >= left - 0.001 && x <= right + 0.001 && y >= bottom - 0.001 && y <= top + 0.001;
      });
    });
    assert(parts.length, "unbound artifact word");
    const ids = parts.map((part) => {
      assert(!owned.has(part.start), "ambiguous artifact word");
      owned.add(part.start);
      const id = parents.length;
      parents.push(null);
      syntheticIds.add(id);
      changes.push({
        start: part.start,
        end: part.end,
        value: `/Span<</MCID ${id}>>BDC\n${part.body}\nEMC`,
      });
      return id;
    });
    const ref = add({
      value: {
        "/Type": "/StructElem",
        "/S": "/Link",
        "/Pg": pageRef,
        "/K": [
          ...ids,
          ...group.map(({ reference }) => ({
            "/Type": "/OBJR",
            "/Obj": reference,
            "/Pg": pageRef,
          })),
        ],
      },
    });
    nodes.push(ref);
    for (const id of ids) parents[id] = ref;
  }
  for (const change of changes.sort((a, b) => b.start - a.start))
    text = text.slice(0, change.start) + change.value + text.slice(change.end);
  return { text, nodes, syntheticIds, originalLength };
}
