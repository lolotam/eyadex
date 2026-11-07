// Local synthetic 60s-per-process layout proof; production remains at 5s.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "/probe/node_modules/@napi-rs/canvas/index.js";
import { fixtures } from "/probe/invoice/fixtures.mjs";
import { invoiceSource } from "/workspace/apps/api/assets/invoice-pdf/template.mjs";
function child(bin, args, input, maxBuffer = 32 * 1024 * 1024) {
  let r = spawnSync(bin, args, { input, maxBuffer, timeout: 60000, env: {} });
  assert.equal(r.status, 0, `${bin}: ${r.error?.code}`);
  return r.stdout;
}
const f = fixtures().find((x) => x.name === "MAXCONTENT");
const model = {
  ...f,
  voidDate: f.dateEn,
  voidDateAr: f.dateAr,
  lines: f.lines.slice(0, 35).map((x) => ({
    ...x,
    discountReasonAr: x.discountReasonAr,
    discountReasonEn: x.discountReasonAr,
  })),
};
const { source } = invoiceSource(model);
const stack = 'stack(dir:if lang=="ar" {rtl} else {ltr},spacing:gap,..row.cells)';
assert(source.includes(stack));
const variants = [
  source.replace(stack, "grid(columns:(auto,)*row.cells.len(),column-gutter:gap,..row.cells)"),
  source,
];
// Keep this run separate from the historical proof artifacts in the same mount.
const outputDir = mkdtempSync("/out/layout-");
const annotationSets = [];
let pages = 0;
const sizes = [];
for (let n = 0; n < variants.length; n++) {
  const raw = child(
    "/opt/typst-x86_64-unknown-linux-musl/typst",
    ["compile", "--ignore-system-fonts", "--font-path", "/fonts", "-", "-"],
    variants[n],
    5 * 1024 * 1024,
  );
  const json = JSON.parse(child("/usr/local/bin/qpdf-memory", ["to-json"], raw));
  const objects = Object.values(json.qpdf[1]);
  pages = objects.filter((x) => x.value?.["/Type"] === "/Page").length;
  const ann = objects
    .filter((x) => x.value?.["/Subtype"] === "/Link")
    .map((x) => ({ uri: x.value["/A"]["/URI"], rect: x.value["/Rect"] }));
  if (n === 1) assert(raw.length < sizes[0] * 0.9, "grid structural overhead returned");
  annotationSets.push(ann);
  sizes.push(raw.length);
  writeFileSync(`${outputDir}/variant-${n}.pdf`, raw);
}
assert.deepEqual(annotationSets[0], annotationSets[1], "word instance coordinates changed");
let checks = 0;
for (const dpi of [96, 144])
  for (let page = 1; page <= pages; page++) {
    if (dpi === 144 && page > 1) continue;
    const pixels = [];
    for (let n = 0; n < 2; n++) {
      const prefix = `${outputDir}/variant-${n}-${page}-${dpi}`;
      child("/usr/local/bin/pdftoppm", [
        "-f",
        String(page),
        "-l",
        String(page),
        "-r",
        String(dpi),
        "-singlefile",
        "-png",
        `${outputDir}/variant-${n}.pdf`,
        prefix,
      ]);
      const img = await loadImage(prefix + ".png");
      const canvas = createCanvas(img.width, img.height),
        ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      pixels.push(Buffer.from(ctx.getImageData(0, 0, img.width, img.height).data));
    }
    assert(pixels[0].equals(pixels[1]), `layout pixels changed at page ${page}, dpi ${dpi}`);
    checks++;
  }
console.log(
  JSON.stringify({
    rows: 35,
    pages,
    annotationInstances: annotationSets[0].length,
    coordinatesExact: true,
    pixelChecks: checks,
    allPagesDpi: 96,
    firstPageDpi: 144,
    baselineBytes: sizes[0],
    candidateBytes: sizes[1],
  }),
);
