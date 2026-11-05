import assert from "node:assert/strict";

// Indirect object numbers are storage details, not document reading order.
export function orderedPages(document) {
  const objects = document.qpdf[1];
  const catalogs = Object.values(objects).filter(
    (object) => object.value?.["/Type"] === "/Catalog",
  );
  assert.equal(catalogs.length, 1, "expected one PDF catalog");
  const seen = new Set(),
    pages = [];
  function walk(ref) {
    assert.equal(typeof ref, "string", "page tree child must be indirect");
    assert(!seen.has(ref), "cyclic or duplicated page tree child");
    seen.add(ref);
    const object = objects["obj:" + ref];
    assert(object?.value, "missing page tree child");
    if (object.value["/Type"] === "/Page") pages.push(["obj:" + ref, object]);
    else {
      assert.equal(object.value["/Type"], "/Pages", "invalid page tree child");
      assert(Array.isArray(object.value["/Kids"]), "missing page tree kids");
      for (const child of object.value["/Kids"]) walk(child);
    }
  }
  walk(catalogs[0].value["/Pages"]);
  assert(pages.length, "empty page tree");
  return pages;
}
