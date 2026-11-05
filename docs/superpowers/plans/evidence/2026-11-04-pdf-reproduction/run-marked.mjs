import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { wrapMarkedFixture } from "./marked-type3.mjs";

// All words, models, PDFs and images are synthetic. No API/worker import or activation.
const words = [
  "مُراجِع",
  "مُحَمَّد",
  "عَلِيّ",
  "فَاطِمَة",
  "أَحْمَد",
  "إِبْرَاهِيم",
  "عَبْدُاللَّه",
  "مُصْطَفَى",
  "آمِنَة",
  "شَدَّةٌ",
  "لَا",
  "مُرَاجَعَةً",
];
const binary = "/opt/typst-x86_64-unknown-linux-musl/typst";
const clean = (text) =>
  text
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
function child(command, args, input) {
  const result = spawnSync(command, args, {
    input,
    env: {},
    cwd: "/",
    timeout: 10_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error)
    throw new Error(
      `synthetic_probe_child_failed:${command}:${result.status ?? result.signal ?? "spawn_error"}`,
    );
  return result.stdout;
}
async function extract(bytes) {
  const loading = getDocument({ data: new Uint8Array(bytes) });
  const document = await loading.promise;
  try {
    assert.equal(document.numPages, 1);
    const content = await (await document.getPage(1)).getTextContent();
    const items = content.items.filter((item) => typeof item.str === "string" && item.str);
    return { text: clean(items.map((item) => item.str).join(" ")), items };
  } finally {
    await loading.destroy();
  }
}
async function samePixels(before, after) {
  const images = await Promise.all([before, after].map(loadImage));
  assert.equal(images[0].width, images[1].width);
  assert.equal(images[0].height, images[1].height);
  const pixels = images.map((image) => {
    const canvas = createCanvas(image.width, image.height),
      context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return Buffer.from(context.getImageData(0, 0, image.width, image.height).data);
  });
  assert(pixels[0].equals(pixels[1]), "page pixels changed");
}
const results = [];
for (const weight of ["regular", "bold"])
  for (const [index, word] of words.entries()) {
    const name = `marked-${weight}-${index}`;
    const source = `#set page(paper: "a4")
#set text(font: "Amiri", weight: "${weight}", lang: "ar", dir: rtl, size: 12pt)
#let word = ${JSON.stringify(word)}
#context [#metadata(measure(text(word)).width.pt()) <advance>]
#par(word)`;
    const options = ["--ignore-system-fonts", "--font-path", "/fonts", "--root", "/fonts"];
    const raw = child(binary, ["compile", ...options, "-", "-"], source);
    writeFileSync(`/out/${name}-raw.pdf`, raw);
    const width = JSON.parse(
      child(binary, ["query", ...options, "-", "<advance>", "--field", "value", "--one"], source),
    );
    const json = JSON.parse(child("/usr/local/bin/qpdf-memory", ["to-json"], raw));
    const fixed = child(
      "/usr/local/bin/qpdf-memory",
      ["from-json"],
      JSON.stringify(wrapMarkedFixture(json, word, width)),
    );
    const before = await extract(raw),
      after = await extract(fixed);
    assert.equal(after.text, word, "pdf.js lost or reordered code points");
    assert.equal(after.items.length, 1);
    assert(Math.abs(after.items[0].width - width) < 0.001, "selection advance differs");
    assert.equal(after.items[0].height, 12);
    assert(after.items[0].transform[3] > 0, "selection Y direction differs");
    const rawPath = `/out/${name}-raw.pdf`,
      path = `/out/${name}-fixed.pdf`;
    writeFileSync(rawPath, raw);
    writeFileSync(path, fixed);
    child("/usr/local/bin/qpdf", ["--check", path]);
    const poppler = clean(child("/usr/local/bin/pdftotext", ["-raw", path, "-"]).toString("utf8"));
    assert.equal(poppler, word, "pdftotext lost or reordered code points");
    for (const dpi of [96, 144]) {
      for (const [suffix, file] of [
        ["raw", rawPath],
        ["fixed", path],
      ])
        child("/usr/local/bin/pdftoppm", [
          "-r",
          String(dpi),
          "-singlefile",
          "-png",
          file,
          `/out/${name}-${suffix}-${dpi}`,
        ]);
      await samePixels(`/out/${name}-raw-${dpi}.png`, `/out/${name}-fixed-${dpi}.png`);
    }
    results.push({
      weight,
      word,
      rawPdfjsExact: before.text === word,
      bothExtractorsExact: true,
      selectionAdvance: width,
      selectionHeight: 12,
      identicalPixelsDpi: [96, 144],
    });
  }
const result = {
  syntheticOnly: true,
  singleWordFixtureOnly: true,
  fullInvoiceAcceptance: false,
  modelToRunBindingImplemented: false,
  taggedPdfAcceptance: false,
  runtimeActivation: false,
  results,
};
assert(
  results.some((result) => !result.rawPdfjsExact),
  "raw extraction regression was not reproduced",
);
writeFileSync("/out/marked-results.json", JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify({ fixtures: results.length, allPassed: true, fullInvoiceAcceptance: false }),
);
