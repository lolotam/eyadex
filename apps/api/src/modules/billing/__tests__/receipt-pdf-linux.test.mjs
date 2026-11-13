import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { getDocument } from "/probe/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { receiptSource } from "../../../../assets/receipt-pdf/template.mjs";
import { bind } from "../../../../assets/invoice-pdf/bind.mjs";
import { orderedPages } from "../../../../assets/invoice-pdf/page-order.mjs";
import { MemoryPdfProcess } from "../rendering/pdf-process.ts";
import { receiptFixtures } from "./receipt-pdf-fixtures.mjs";

const typst = "/opt/typst-x86_64-unknown-linux-musl/typst";
const qpdf = "/usr/local/bin/qpdf-memory";
const clean = (value) =>
  value
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
function run(binary, args, input, limit = 32 * 1024 * 1024) {
  const result = spawnSync(binary, args, {
    input,
    timeout: 5000,
    maxBuffer: limit,
    env: {},
    cwd: "/",
  });
  assert.equal(result.status, 0, `receipt tool failed: ${binary}`);
  assert(!result.error, "receipt tool error");
  return result.stdout;
}

for (const { name, model } of receiptFixtures()) {
  test(`receipt ${name}: complete bilingual extraction and unchanged page pixels`, async () => {
    const { source, words, fields } = receiptSource(model);
    const raw = run(
      typst,
      ["compile", "--ignore-system-fonts", "--font-path", "/fonts", "-", "-"],
      source,
      5 * 1024 * 1024,
    );
    const document = JSON.parse(run(qpdf, ["to-json"], raw));
    assert.equal(orderedPages(document).length, 1, "receipt fits one A4 page");
    bind(document, words);
    const final = run(qpdf, ["from-json"], JSON.stringify(document), 5 * 1024 * 1024);
    assert(raw.length < 5 * 1024 * 1024 && final.length < 5 * 1024 * 1024);
    const loading = getDocument({ data: new Uint8Array(final) });
    const loaded = await loading.promise;
    try {
      const page = await loaded.getPage(1);
      const content = await page.getTextContent();
      const actual = clean(content.items.map((item) => item.str ?? "").join(" "));
      const poppler = clean(run("/usr/local/bin/pdftotext", ["-raw", "-", "-"], final).toString());
      for (const field of fields) {
        assert(actual.includes(clean(field)), `pdf.js missing receipt field: ${name}`);
        assert(poppler.includes(clean(field)), `Poppler missing receipt field: ${name}`);
      }
      assert(await page.getStructTree(), "receipt retains accessibility structure");
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        assert(item.transform[4] >= 0 && item.transform[4] <= 596, "receipt text outside width");
        assert(item.transform[5] >= 0 && item.transform[5] <= 843, "receipt text outside height");
      }
    } finally {
      await loading.destroy();
    }
    // Synthetic-only test files; production render.mjs never writes document bytes.
    const directory = await mkdtemp(join(tmpdir(), "receipt-pixels-"));
    const rawPath = join(directory, "raw.pdf"),
      finalPath = join(directory, "final.pdf");
    try {
      await writeFile(rawPath, raw);
      await writeFile(finalPath, final);
      const pixels = (path) => run("/usr/local/bin/pdftoppm", ["-r", "72", "-singlefile", path]);
      assert(pixels(rawPath).equals(pixels(finalPath)), "binding changed receipt page pixels");
    } finally {
      await unlink(rawPath);
      await unlink(finalPath);
      await rmdir(directory);
    }
  });
}

test("receipt child pipeline emits a bounded PDF under the existing execution budget", async () => {
  const script = fileURLToPath(
    new URL("../../../../assets/receipt-pdf/render.mjs", import.meta.url),
  );
  const output = await new MemoryPdfProcess().run(
    process.execPath,
    [script, JSON.stringify({ typst, qpdf, fonts: "/fonts", root: "/pdf-root" })],
    Buffer.from(JSON.stringify(receiptFixtures()[0].model)),
  );
  assert(Buffer.from(output).subarray(0, 5).equals(Buffer.from("%PDF-")));
  assert(output.length < 5 * 1024 * 1024);
});

test("receipt child refuses invalid input without partial output", () => {
  const script = fileURLToPath(
    new URL("../../../../assets/receipt-pdf/render.mjs", import.meta.url),
  );
  const output = spawnSync(process.execPath, [script, "{}"], {
    input: "{}",
    env: {},
    timeout: 5000,
  });
  assert.equal(output.status, 1);
  assert.equal(output.stdout.length, 0);
  assert.equal(output.stderr.length, 0);
});
