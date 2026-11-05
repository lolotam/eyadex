import assert from "node:assert/strict";

// Research only: one synthetic Arabic word occupying a complete one-page document.
// The caller supplies the exact source word and its Typst-measured advance.
// This is not a PDF parser, a model-to-run binding implementation, or a runtime renderer.
export function wrapMarkedFixture(document, word, width, size = 12) {
  assert.match(word, /^(?:(?=\p{Script_Extensions=Arabic})[\p{L}\p{M}])+$/u);
  assert(/\p{L}/u.test(word) && /\p{M}/u.test(word));
  assert(Number.isFinite(width) && width > 0 && width < 500);
  assert.equal(size, 12);
  const objects = document.qpdf[1];
  const resolve = (value) => (typeof value === "string" ? objects[`obj:${value}`]?.value : value);
  const pages = Object.values(objects).filter((object) => object.value?.["/Type"] === "/Page");
  assert.equal(pages.length, 1);
  const resources = resolve(pages[0].value["/Resources"]);
  const fonts = resolve(resources["/Font"]);
  assert.equal(Object.keys(fonts).length, 1);
  const originalFonts = structuredClone(fonts);
  const originalResources = structuredClone(resources);
  originalResources["/Font"] = originalFonts;
  const contents = [pages[0].value["/Contents"]].flat();
  assert.equal(contents.length, 1);
  const target = objects[`obj:${contents[0]}`];
  assert(target?.stream);
  const content = Buffer.from(target.stream.data, "base64").toString("latin1");
  const bodies = [...content.matchAll(/BT([\s\S]*?)ET/g)];
  assert(bodies.length > 0);
  assert(content.includes("/ActualText"), "fixture must exercise Typst marked text");
  const origins = [...content.matchAll(/q 1 0 0 -1 ([\d.]+) ([\d.]+) cm/g)];
  assert.equal(origins.length, bodies.length);
  const x = Math.min(...origins.map((match) => Number(match[1])));
  const y = Number(origins[0][2]);
  for (const match of content.matchAll(/(\/\w+)\s+([\d.]+)\s+Tf/g)) {
    assert(originalFonts[match[1]]);
    assert.equal(Number(match[2]), size);
  }
  assert(!fonts["/researchWord"], "reserved resource collision");
  let next =
    Math.max(...Object.keys(objects).map((key) => Number(key.match(/^obj:(\d+)/)?.[1] ?? 0))) + 1;
  const add = (object) => {
    const reference = `${next++} 0 R`;
    objects[`obj:${reference}`] = object;
    return reference;
  };
  const stream = (text) =>
    add({
      stream: {
        dict: {},
        data: Buffer.from(text, "latin1").toString("base64"),
      },
    });
  // Both pinned extractors apply bidi to ToUnicode. Keep the full reverse-codepoint
  // sequence, including every combining mark. A separate code per point avoids
  // pdf.js treating a whole marked-word mapping as one zero-width diacritic.
  const points = [...word].reverse();
  assert(points.length < 256);
  const charProcs = {},
    widths = [],
    differences = [1];
  let assignedAdvance = false;
  for (let index = 0; index < points.length; index++) {
    const advance = !assignedAdvance && /\p{L}/u.test(points[index]) ? width : 0;
    if (advance) assignedAdvance = true;
    const name = `/part${index}`;
    // Replay the complete isolated word page at its original absolute positions.
    // This deliberately avoids claiming a general word-to-content-run binding.
    charProcs[name] = stream(
      `${advance} 0 d0\n${index === 0 ? `1 0 0 1 ${-x} ${-y} cm\n${content}` : ""}`,
    );
    widths.push(advance);
    differences.push(name);
  }
  const hex = (text) => Buffer.from(text, "utf16le").swap16().toString("hex");
  const code = (index) => (index + 1).toString(16).padStart(2, "0");
  const cmap = stream(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /ResearchWord def /CMapType 2 def
1 begincodespacerange <00> <FF> endcodespacerange
${points.length} beginbfchar
${points.map((point, index) => `<${code(index)}> <${hex(point)}>`).join("\n")}
endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`);
  const descriptor = add({
    value: {
      "/Type": "/FontDescriptor",
      "/FontName": "/ResearchWord",
      "/Flags": 4,
      "/FontBBox": [-size, -3, width + size, 9],
      "/ItalicAngle": 0,
      "/Ascent": 9,
      "/Descent": -3,
      "/CapHeight": 9,
      "/StemV": 1,
    },
  });
  const font = add({
    value: {
      "/Type": "/Font",
      "/Subtype": "/Type3",
      "/Name": "/ResearchWord",
      "/FontBBox": [-size, -3, width + size, 9],
      "/FontMatrix": [1, 0, 0, 1, 0, 0],
      "/FontDescriptor": descriptor,
      "/CharProcs": charProcs,
      "/Encoding": { "/Type": "/Encoding", "/Differences": differences },
      "/FirstChar": 1,
      "/LastChar": points.length,
      "/Widths": widths,
      "/Resources": originalResources,
      "/ToUnicode": cmap,
    },
  });
  fonts["/researchWord"] = font;
  // Bound the visual sequence with explicit RTL embedding. Without it, Poppler
  // moves a leading visual combining mark (a logical trailing mark) outside the word.
  const replacement = `/Span <</ActualText <feff${hex("\u202b" + points.join("") + "\u202c")}>>> BDC
BT /researchWord 1 Tf 1 0 0 1 ${x} ${y} Tm <${points.map((_, index) => code(index)).join("")}> Tj ET
EMC`;
  target.stream.data = Buffer.from(replacement, "latin1").toString("base64");
  return document;
}
