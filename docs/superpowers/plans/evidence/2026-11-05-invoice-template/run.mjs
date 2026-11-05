import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { bind } from "./bind.mjs";
import { fixtures } from "./fixtures.mjs";
import { invoiceSource } from "./template.mjs";
import { expectedOrder, ordered, validateBindings } from "./structure.mjs";
import { guardTests } from "./guards.mjs";

const clean = (s) =>
  s
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
function child(binary, args, input) {
  const result = spawnSync(binary, args, {
    input,
    env: {},
    cwd: "/",
    // Proof limits are not production deadlines; MAXCONTENT measures that gap.
    timeout: /\/(pdftoppm|pdftotext|typst|qpdf)$/.test(binary) ? 60_000 : 15_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error)
    throw new Error(`synthetic_probe_failed:${binary}:${result.status ?? result.signal}`);
  return result.stdout;
}
async function inspect(bytes) {
  const loading = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await loading.promise;
  try {
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p),
        text = await page.getTextContent();
      assert(Math.abs(page.view[2] - page.view[0] - 595.276) < 0.01);
      assert(Math.abs(page.view[3] - page.view[1] - 841.89) < 0.01);
      assert(await page.getStructTree(), "missing structure tree");
      pages.push(clean(text.items.map((item) => item.str ?? "").join(" ")));
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}
async function samePixels(name, pages) {
  for (const dpi of [96, 144])
    for (let page = 1; page <= pages; page++) {
      if (dpi === 144 && page > 1) continue;
      const paths = ["raw", "fixed"].map((kind) => `/out/${name}-${kind}-${page}-${dpi}`);
      for (const [index, kind] of ["raw", "fixed"].entries())
        child("/usr/local/bin/pdftoppm", [
          "-f",
          String(page),
          "-l",
          String(page),
          "-r",
          String(dpi),
          "-singlefile",
          "-png",
          `/out/${name}-${kind}.pdf`,
          paths[index],
        ]);
      const images = await Promise.all(paths.map((path) => loadImage(path + ".png")));
      assert.equal(images[0].width, images[1].width);
      assert.equal(images[0].height, images[1].height);
      const pixels = images.map((image) => {
        const c = createCanvas(image.width, image.height),
          ctx = c.getContext("2d");
        ctx.drawImage(image, 0, 0);
        return Buffer.from(ctx.getImageData(0, 0, image.width, image.height).data);
      });
      assert(pixels[0].equals(pixels[1]), `page pixels differ: ${name}:${page}:${dpi}`);
    }
}
const logo = createCanvas(80, 40),
  ctx = logo.getContext("2d");
ctx.fillStyle = "#006e68";
ctx.fillRect(0, 0, 80, 40);
ctx.fillStyle = "#ffffff";
ctx.fillRect(35, 8, 10, 24);
ctx.fillRect(27, 15, 26, 10);
const guards = guardTests();
const results = [];
for (const model of fixtures([...logo.toBuffer("image/png")])) {
  if (model.name === "LONGWORD")
    for (const value of [model.lines[0].discountReasonAr, model.invoiceDiscountReason]) {
      assert.equal(value.length, 300, "long Arabic fixture must reach glyph grouping");
      assert(!/\s/u.test(value), "long Arabic fixture must be unbroken");
    }
  if (model.name === "MAXCONTENT")
    for (const line of model.lines)
      for (const [key, length] of [
        ["descriptionAr", 200],
        ["descriptionEn", 200],
        ["discountReasonAr", 300],
        ["discountReasonEn", 300],
      ])
        assert.equal(line[key].trim().length, length, `maximum fixture length: ${key}`);
  const { source, words, fields, roles, sourceOrder, fieldRecords } = invoiceSource(model);
  writeFileSync(`/out/${model.name}.typ`, source);
  const renderStarted = performance.now();
  const raw = child(
    "/opt/typst-x86_64-unknown-linux-musl/typst",
    ["compile", "--ignore-system-fonts", "--font-path", "/fonts", "-", "-"],
    source,
  );
  const typstMs = Math.round(performance.now() - renderStarted);
  assert(raw.length < 5 * 1024 * 1024, "intermediate PDF exceeds size bound");
  const json = JSON.parse(child("/usr/local/bin/qpdf-memory", ["to-json"], raw));
  const objects = json.qpdf[1],
    resolve = (ref) => objects["obj:" + ref]?.value;
  for (const object of Object.values(objects))
    if (object.value?.["/Subtype"] === "/Type0") {
      const descendant = resolve(object.value["/DescendantFonts"][0]);
      const descriptor = resolve(descendant["/FontDescriptor"]);
      assert(
        objects["obj:" + (descriptor["/FontFile2"] ?? descriptor["/FontFile3"])]?.stream,
        "font is not embedded",
      );
    }
  const { rowPages } = validateBindings(json, words, roles, fieldRecords);
  const expected = expectedOrder(json, words, roles, sourceOrder),
    result = bind(json, words);
  for (const object of Object.values(objects)) {
    const data = object.stream?.data;
    if (!data) continue;
    const cmap = Buffer.from(data, "base64").toString("latin1");
    if (!cmap.includes("begincmap")) continue;
    for (const match of cmap.matchAll(/<[\da-f]+>\s*<([\da-f]+)>/gi))
      assert(match[1].length / 2 <= 512, "ToUnicode destination exceeds 512 bytes");
  }
  assert(!JSON.stringify(json).includes("urn:e:"), "binding annotation leaked");
  const fixed = child("/usr/local/bin/qpdf-memory", ["from-json"], JSON.stringify(json));
  assert(fixed.length < 5 * 1024 * 1024);
  for (const [kind, data] of [
    ["raw", raw],
    ["fixed", fixed],
  ])
    writeFileSync(`/out/${model.name}-${kind}.pdf`, data);
  child("/usr/local/bin/qpdf", ["--check", `/out/${model.name}-fixed.pdf`]);
  const texts = await inspect(fixed);
  const popPages = child("/usr/local/bin/pdftotext", ["-raw", `/out/${model.name}-fixed.pdf`, "-"])
    .toString()
    .split("\f")
    .filter((page) => page.trim())
    .map(clean);
  assert.equal(popPages.length, texts.length);
  const pop = clean(popPages.join(" "));
  const js = clean(texts.join(" "));
  for (const field of fields) {
    assert(js.includes(clean(field)), `pdf.js missing: ${model.name}:${field}`);
    assert(pop.includes(clean(field)), `poppler missing: ${model.name}:${field}`);
  }
  for (let p = 0; p < texts.length; p++) {
    for (const field of fieldRecords)
      if (field.role === "page" || (field.role === "table-header" && rowPages.has(p))) {
        assert(texts[p].includes(clean(field.value)), "pdf.js repeated field missing");
        assert(popPages[p].includes(clean(field.value)), "poppler repeated field missing");
      }
    ordered(texts[p], expected[p]);
    assert(texts[p].includes(`${p + 1} / ${texts.length}`));
    assert(popPages[p].includes(`${p + 1} / ${texts.length}`));
    if (model.voidReason)
      for (const text of [texts[p], popPages[p]]) {
        assert(text.includes("فاتورة ملغاة"));
        assert(text.includes("VOID INVOICE"));
        assert(text.includes(model.voidReason));
        assert(text.includes(model.voidDate));
      }
  }
  ordered(pop, expected.flat());
  results.push({
    name: model.name,
    pages: texts.length,
    modelFields: fields.length,
    orderedWords: expected.flat().length,
    correctedWords: result.corrected,
    pdfjs: true,
    poppler: true,
    pixelChecks: null,
    bytes: fixed.length,
    intermediateBytes: raw.length,
    typstMs,
  });
  console.log(JSON.stringify(results.at(-1)));
}
for (const result of results) {
  await samePixels(result.name, result.pages);
  result.pixelChecks = { allPagesDpi: 96, firstPageDpi: 144 };
  console.log(JSON.stringify({ name: result.name, pixels: "passed" }));
}
writeFileSync(
  "/out/invoice-results.json",
  JSON.stringify(
    {
      syntheticOnly: true,
      runtimeActivation: false,
      fullInvoiceAcceptance: false,
      guards,
      results,
    },
    null,
    2,
  ) + "\n",
);
