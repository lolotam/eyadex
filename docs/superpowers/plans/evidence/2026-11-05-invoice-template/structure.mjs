import assert from "node:assert/strict";
import { wordId } from "./word-id.mjs";
export function expectedOrder(document, words, roles, sourceOrder) {
  const objects = document.qpdf[1],
    resolve = (v) => (typeof v === "string" ? objects["obj:" + v]?.value : v);
  const root = Object.values(objects).find((o) => o.value?.["/Type"] === "/StructTreeRoot").value;
  const pages = Object.entries(objects)
    .filter(([k, o]) => o.value?.["/Type"] === "/Page")
    .map(([k]) => k.slice(4));
  const result = pages.map(() => []);
  const seen = new Set();
  const bodyOrder = [];
  function walk(ref) {
    if (typeof ref !== "string") return;
    assert(!seen.has(ref));
    seen.add(ref);
    const node = resolve(ref);
    if (node["/S"] === "/Link") {
      const objr = [node["/K"]].flat().find((v) => v?.["/Type"] === "/OBJR");
      const annot = resolve(objr["/Obj"]),
        uri = annot?.["/A"]?.["/URI"];
      if (uri?.startsWith("u:urn:e:")) {
        const id = wordId(uri),
          word = words[id];
        assert(word);
        const page = pages.indexOf(node["/Pg"]);
        assert(page >= 0);
        result[page].push(word);
        if (roles && (roles[id] === "single" || roles[id] === "row")) bodyOrder.push(id);
        return;
      }
    }
    for (const child of [node["/K"]].flat()) walk(child);
  }
  for (const ref of [root["/K"]].flat()) walk(ref);
  if (sourceOrder) assert.deepEqual(bodyOrder, sourceOrder, "source field order changed");
  return result;
}
export function validateBindings(document, words, roles, fieldRecords = []) {
  const objects = document.qpdf[1],
    pages = Object.values(objects).filter((o) => o.value?.["/Type"] === "/Page");
  const seen = new Map(),
    rowPages = new Set();
  const instances = new Map();
  const pageIds = [];
  pages.forEach((page, index) => {
    const ids = [];
    pageIds.push(ids);
    for (const ref of page.value["/Annots"] ?? []) {
      const annotation = objects["obj:" + ref]?.value;
      const uri = annotation?.["/A"]?.["/URI"];
      if (!uri?.startsWith("u:urn:e:")) continue;
      const id = wordId(uri);
      const instanceKey = id + ":" + index;
      const instance = instances.get(instanceKey) ?? uri;
      assert.equal(instance, uri, "duplicate field instance");
      instances.set(instanceKey, uri);
      if (ids.at(-1) !== id) ids.push(id);
      assert(Object.hasOwn(words, id));
      const [left, bottom, right, top] = annotation["/Rect"],
        box = page.value["/MediaBox"];
      assert(
        left >= box[0] - 0.01 &&
          bottom >= box[1] - 0.01 &&
          right <= box[2] + 0.01 &&
          top <= box[3] + 0.01,
        "word outside page",
      );
      if (roles[id] === "row") assert(right - left <= 244.246, "word exceeds row column width");
      const set = seen.get(id) ?? new Set();
      set.add(index);
      seen.set(id, set);
      if (roles[id] === "row") rowPages.add(index);
    }
  });
  assert.deepEqual([...seen.keys()].sort(), Object.keys(words).sort(), "missing allocated word");
  for (const [id, set] of seen) {
    const expected =
      roles[id] === "page" ? pages.length : roles[id] === "table-header" ? rowPages.size : 1;
    assert.equal(set.size, expected, "missing repeated field: " + id);
    if (roles[id] === "table-header") assert.deepEqual([...set].sort(), [...rowPages].sort());
  }
  for (const field of fieldRecords)
    if (field.role === "page" || field.role === "table-header") {
      for (let page = 0; page < pages.length; page++)
        if (field.role === "page" || rowPages.has(page)) {
          const actual = pageIds[page].filter((id) => field.ids.includes(id));
          assert.deepEqual(actual, field.ids, "repeated field order changed");
        }
    }
  return { rowPages };
}
export function ordered(text, words) {
  let position = 0;
  for (const word of words) {
    const literal = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(
      "(?<![\\p{L}\\p{M}\\p{N}])" + literal + "(?![\\p{L}\\p{M}\\p{N}])",
      "u",
    ).exec(text.slice(position));
    assert(match, "missing or out-of-order field: " + word);
    position += match.index + match[0].length;
  }
  return words.length;
}
