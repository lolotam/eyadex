import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { correct } from "./correct.mjs";

// All inputs and persisted outputs are synthetic. This is not an API renderer or release gate.
const corpus = JSON.parse(readFileSync("/probe/corpus.json", "utf8"));
const english = [
  "Invoice",
  "Receipt",
  "15 October 2026",
  "15.000 KWD",
  "Test clinic",
  "sample correction",
];
const output = "/out";
mkdirSync(output, { recursive: true });
const clean = (text) =>
  text
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const hasField = (text, field) => {
  const literal = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${literal}(?![\\p{L}\\p{M}\\p{N}])`, "u").test(text);
};
assert.equal(hasField("المراجع", "مراجع"), false);
assert.equal(hasField("العيادة", "عيادة"), false);
assert.equal(hasField("دينار كويتي", "دينار كويتي"), true);

function child(binary, args, input) {
  const result = spawnSync(binary, args, {
    input,
    env: {},
    cwd: "/",
    timeout: 10_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw new Error("synthetic_probe_child_failed");
  return result.stdout;
}

function render(name, phrases, weight = "regular", extras = true) {
  const expected = extras ? [...phrases, ...english, "جلسة 15.000 KWD"] : phrases;
  // Separate grid cells retain logical phrase order while each Arabic word remains shaped.
  const source = `#set page(paper: "a4")
#set text(font: "Amiri", weight: "${weight}", lang: "ar", dir: rtl, size: 12pt)
#let words = json(bytes(${JSON.stringify(JSON.stringify(phrases))}))
#for phrase in words {
  let parts = phrase.split(" ")
  if parts.len() > 1 {
    grid(columns: (auto,) * parts.len(), column-gutter: 0.25em, ..parts.map(part => text(part)))
    parbreak()
  } else { par(phrase) }
}
${
  extras
    ? `#let english = json(bytes(${JSON.stringify(JSON.stringify(english))}))
#for phrase in english { par(text(dir: ltr, lang: "en", phrase)) }
#grid(columns: (auto, auto), column-gutter: 0.25em, [جلسة], text(dir: ltr, lang: "en", "15.000 KWD"))`
    : ""
}
`;
  const raw = child(
    "/opt/typst-x86_64-unknown-linux-musl/typst",
    ["compile", "--ignore-system-fonts", "--font-path", "/fonts", "--root", "/fonts", "-", "-"],
    source,
  );
  writeFileSync(`${output}/${name}-raw.pdf`, raw);
  const json = JSON.parse(child("/usr/local/bin/qpdf-memory", ["to-json"], raw));
  return { raw, json, expected };
}

async function extract(file, expected) {
  const loading = getDocument({ data: new Uint8Array(readFileSync(file)) });
  const doc = await loading.promise;
  try {
    const text = [];
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      text.push(
        content.items
          .filter((item) => typeof item.str === "string")
          .map((item) => item.str)
          .join(" "),
      );
    }
    const js = clean(text.join(" "));
    const poppler = clean(child("/usr/bin/pdftotext", ["-raw", file, "-"]).toString("utf8"));
    for (const forbidden of corpus.forbiddenRenderedText) {
      assert(
        !js.includes(forbidden) && !poppler.includes(forbidden),
        "forbidden currency abbreviation",
      );
    }
    return {
      pages: doc.numPages,
      pdfjsMisses: expected.filter((field) => !hasField(js, field)),
      popplerMisses: expected.filter((field) => !hasField(poppler, field)),
    };
  } finally {
    await loading.destroy();
  }
}

async function pixels(name, pages) {
  for (const kind of ["raw", "corrected"]) {
    child("/usr/bin/pdftoppm", [
      "-r",
      "96",
      "-png",
      `${output}/${name}-${kind}.pdf`,
      `${output}/${name}-${kind}-page`,
    ]);
  }
  const results = [];
  for (let page = 1; page <= pages; page++) {
    const images = [];
    for (const kind of ["raw", "corrected"]) {
      const image = await loadImage(`${output}/${name}-${kind}-page-${page}.png`);
      const canvas = createCanvas(image.width, image.height);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      images.push({
        width: image.width,
        height: image.height,
        data: context.getImageData(0, 0, image.width, image.height).data,
      });
    }
    assert.equal(images[0].width, images[1].width);
    assert.equal(images[0].height, images[1].height);
    assert.deepEqual(images[0].data, images[1].data, "qpdf changed rendered pixels");
    results.push({
      page,
      width: images[0].width,
      height: images[0].height,
      differingChannels: 0,
      sha256: createHash("sha256").update(images[0].data).digest("hex"),
    });
  }
  return results;
}

const results = {
  status: "synthetic_research_only",
  fullInvoiceAcceptance: false,
  runtimeDeadlineAcceptance: false,
  deploymentCrashProtectionAcceptance: false,
  versions: {
    node: process.version,
    typst: child("/opt/typst-x86_64-unknown-linux-musl/typst", ["--version"]).toString().trim(),
    qpdf: child("/usr/bin/qpdf", ["--version"]).toString().split("\n")[0],
    pdfjs: "6.3.289",
    poppler: "25.12.0",
  },
  cases: [],
};
assert.equal(corpus.entries.length, 40);
for (const weight of ["regular", "bold"]) {
  const fixture = render(weight, corpus.entries, weight);
  const raw = await extract(`${output}/${weight}-raw.pdf`, fixture.expected);
  const transformed = correct(fixture.json);
  const bytes = child(
    "/usr/local/bin/qpdf-memory",
    ["from-json"],
    JSON.stringify(transformed.document),
  );
  writeFileSync(`${output}/${weight}-corrected.pdf`, bytes);
  const corrected = await extract(`${output}/${weight}-corrected.pdf`, fixture.expected);
  assert.deepEqual(corrected.pdfjsMisses, []);
  assert.deepEqual(corrected.popplerMisses, []);
  assert.equal(raw.pages, corrected.pages);
  assert(raw.popplerMisses.length > 0, "fixture must reproduce the uncorrected regression");
  results.cases.push({
    name: weight,
    expectedEntries: fixture.expected.length,
    spans: transformed.spans,
    raw,
    corrected,
    pixels: await pixels(weight, corrected.pages),
  });
}

// Required text which the simple fixture transform cannot yet handle is a visible release blocker.
const marked = render("marked-name", ["مُراجِع تجريبي"], "regular", false);
const markedRaw = await extract(`${output}/marked-name-raw.pdf`, marked.expected);
assert(markedRaw.pdfjsMisses.length > 0 && markedRaw.popplerMisses.length > 0);
assert.throws(() => correct(marked.json), /unsupported_marked_text/);
results.cases.push({
  name: "marked-name",
  raw: markedRaw,
  correction: "unsupported_marked_text",
  accepted: false,
  rawFallbackReturned: false,
});
writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
