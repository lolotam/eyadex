import assert from "node:assert/strict";
import { correct } from "./correct.mjs";

// Minimal Identity-H objects isolate classification from Typst's producer-emitted ActualText.
function fixture(visual, encoding = "literal") {
  const utf16 = Buffer.from(visual, "utf16le").swap16().toString("hex");
  const content = `BT /F1 12 Tf ${encoding === "hex" ? "<0001>" : "(\\000\\001)"} Tj ET`;
  return {
    qpdf: [
      {},
      {
        "obj:1 0 R": { value: { "/Resources": { "/Font": { "/F1": "2 0 R" } } } },
        "obj:2 0 R": {
          value: {
            "/Encoding": "/Identity-H",
            "/ToUnicode": "3 0 R",
            "/DescendantFonts": ["4 0 R"],
          },
        },
        "obj:3 0 R": {
          stream: {
            data: Buffer.from(`1 beginbfchar <0001> <${utf16}> endbfchar`).toString("base64"),
          },
        },
        "obj:4 0 R": { value: { "/W": [1, [500]], "/DW": 500 } },
        "obj:5 0 R": { stream: { data: Buffer.from(content).toString("base64") } },
      },
    ],
  };
}

for (const encoding of ["literal", "hex"]) {
  for (const visual of ["١٥", "١٬٢٣٤٫٥٠٠", "١٥/١٠/٢٠٢٦", "Invoice", "Café"]) {
    const input = fixture(visual, encoding);
    const result = correct(structuredClone(input));
    assert.equal(result.spans, 0, visual);
    assert.deepEqual(
      result.document,
      input,
      "numeric and Latin runs must remain byte-for-byte unchanged",
    );
  }
  assert.throws(() => correct(fixture("مُراجع", encoding)), /unsupported_marked_text/);
  assert.throws(() => correct(fixture("ُ", encoding)), /unsupported_marked_text/);
  for (const visual of ["جلسة١٥", "جلسة،", "جلـسة", "جلسة ", "جلسةInvoice"]) {
    assert.throws(() => correct(fixture(visual, encoding)), /unsupported_mixed_run/, visual);
  }
  for (const visual of ["مُراجع١٥", "مُراجع،", "مُراجع ", "مُراجعInvoice"]) {
    assert.throws(() => correct(fixture(visual, encoding)), /unsupported_marked_text/, visual);
  }
  for (const visual of ["ُInvoice", "Invoiceُ", "ُ١٥", "ُ،", "ُ ", "ُ🙂"]) {
    assert.throws(() => correct(fixture(visual, encoding)), /unsupported_marked_text/, visual);
  }
  const dictionary = fixture("ةسلج", encoding);
  const content = Buffer.from(dictionary.qpdf[1]["obj:5 0 R"].stream.data, "base64")
    .toString()
    .replace("BT ", "BT /P <</MCID 3>> BDC ")
    .replace(" ET", " EMC ET");
  dictionary.qpdf[1]["obj:5 0 R"].stream.data = Buffer.from(content).toString("base64");
  assert.throws(() => correct(dictionary), /unsupported_inline_dictionary/);
  const arabic = correct(fixture("ةسلج", encoding));
  assert.equal(arabic.spans, 1);
  assert.deepEqual(arabic.decodedWords, ["جلسة"]);
}
