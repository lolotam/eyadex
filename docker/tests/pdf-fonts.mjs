import assert from "node:assert/strict";

export function assertEmbeddedPdfFonts(document) {
  const objects = document.qpdf[1];
  const descriptors = Object.values(objects).filter(
    (o) => o.value?.["/Type"] === "/FontDescriptor",
  );
  const amiri = descriptors.filter((o) => /Amiri-(Regular|Bold)$/.test(o.value["/FontName"]));
  assert.equal(amiri.length, 2);
  for (const face of ["Regular", "Bold"]) {
    assert.equal(
      amiri.filter((o) => o.value["/FontName"].endsWith(`Amiri-${face}`)).length,
      1,
      `expected exactly one Amiri-${face} descriptor`,
    );
  }
  const stream = (ref) => {
    const data = objects["obj:" + ref]?.stream?.data;
    return typeof data === "string" && data.length > 0;
  };
  assert(amiri.every((o) => stream(o.value["/FontFile2"] ?? o.value["/FontFile3"])));
  // Type3 fonts carry their glyph programs in CharProcs rather than FontFile2.
  const type3 = Object.values(objects).filter((o) => o.value?.["/Subtype"] === "/Type3");
  assert(type3.length > 0, "missing Type3 glyph fonts");
  for (const object of type3) {
    const procs = object.value["/CharProcs"];
    const resolved = typeof procs === "string" ? objects["obj:" + procs]?.value : procs;
    assert(resolved && Object.keys(resolved).length > 0, "missing Type3 glyph programs");
    assert(Object.values(resolved).every(stream), "missing embedded Type3 glyph stream");
  }
}
