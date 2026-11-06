import assert from "node:assert/strict";
import { glyphDrawings } from "./glyph-drawing.mjs";

export function glyphEncodingGuards(document, model, readDrawing = glyphDrawings) {
  assert(readDrawing(document, model.words, model.fieldRecords).words.length > 0);
  for (const encoding of ["/Identity-V", undefined, "custom"]) {
    const changed = structuredClone(document);
    const objects = changed.qpdf[1];
    const reference = `${Math.max(...Object.keys(objects).map((key) => Number(key.match(/^obj:(\d+)/)?.[1] ?? 0))) + 1} 0 R`;
    objects["obj:" + reference] = {
      stream: {
        dict: {},
        data: Buffer.from(
          "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapType 1 def /WMode 0 def 1 begincodespacerange <0000> <ffff> endcodespacerange 1 begincidchar <0001> 2 endcidchar endcmap end end",
        ).toString("base64"),
      },
    };
    let changedFonts = 0;
    for (const object of Object.values(objects))
      if (object.value?.["/Subtype"] === "/Type0") {
        object.value["/Encoding"] = encoding === "custom" ? reference : encoding;
        changedFonts++;
      }
    assert(changedFonts > 0);
    assert.throws(
      () => readDrawing(changed, model.words, model.fieldRecords),
      /unsupported glyph encoding/,
    );
  }
  return { nonIdentityEncodingRejected: true };
}
