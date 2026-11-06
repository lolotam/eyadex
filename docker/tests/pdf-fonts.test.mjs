import assert from "node:assert/strict";
import test from "node:test";
import { assertEmbeddedPdfFonts } from "./pdf-fonts.mjs";

function fixture() {
  return {
    qpdf: [
      {},
      {
        "obj:1 0 R": {
          value: {
            "/Type": "/FontDescriptor",
            "/FontName": "/Amiri-Regular",
            "/FontFile2": "3 0 R",
          },
        },
        "obj:2 0 R": {
          value: { "/Type": "/FontDescriptor", "/FontName": "/Amiri-Bold", "/FontFile2": "5 0 R" },
        },
        "obj:3 0 R": { stream: { data: Buffer.from("regular-program").toString("base64") } },
        "obj:5 0 R": { stream: { data: Buffer.from("bold-program").toString("base64") } },
        "obj:4 0 R": { value: { "/Subtype": "/Type3", "/CharProcs": { "/g": "3 0 R" } } },
      },
    ],
  };
}

test("accepts embedded Amiri and nonempty Type3 glyph programs", () => {
  assert.doesNotThrow(() => assertEmbeddedPdfFonts(fixture()));
});
for (const change of [
  "missing-type3",
  "empty-glyphs",
  "missing-stream",
  "missing-amiri",
  "duplicate-regular",
  "duplicate-bold",
  "shared-program",
  "duplicated-program",
]) {
  test(`refuses ${change}`, () => {
    const document = fixture(),
      objects = document.qpdf[1];
    if (change === "missing-type3") delete objects["obj:4 0 R"];
    if (change === "empty-glyphs") objects["obj:4 0 R"].value["/CharProcs"] = {};
    if (change === "missing-stream") objects["obj:3 0 R"].stream.data = "";
    if (change === "missing-amiri") delete objects["obj:1 0 R"];
    if (change === "duplicate-regular") objects["obj:2 0 R"].value["/FontName"] = "/Amiri-Regular";
    if (change === "duplicate-bold") objects["obj:1 0 R"].value["/FontName"] = "/Amiri-Bold";
    if (change === "shared-program") objects["obj:2 0 R"].value["/FontFile2"] = "3 0 R";
    if (change === "duplicated-program")
      objects["obj:5 0 R"].stream.data = objects["obj:3 0 R"].stream.data;
    assert.throws(() => assertEmbeddedPdfFonts(document));
  });
}
