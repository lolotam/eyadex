import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { MemoryPdfProcess } from "../rendering/pdf-process.ts";
import { fixtures } from "/probe/invoice/fixtures.mjs";
import { getDocument } from "/probe/node_modules/pdfjs-dist/legacy/build/pdf.mjs";

const runner = new MemoryPdfProcess();
const script = fileURLToPath(new URL("../../../../assets/invoice-pdf/render.mjs", import.meta.url));
const paths = JSON.stringify({
  typst: "/opt/typst-x86_64-unknown-linux-musl/typst",
  qpdf: "/usr/local/bin/qpdf-memory",
  fonts: "/fonts",
  root: "/pdf-root",
});

test("Linux deadline kills the bridge and its descendant process before releasing the slot", async () => {
  const bounded = new MemoryPdfProcess({ executionMs: 1000 });
  const childCode = `const {spawn}=require('node:child_process');const fs=require('node:fs');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    fs.writeFileSync('/tmp/pdf-test-child-pid',String(child.pid));setInterval(()=>{},1000);`;
  await assert.rejects(bounded.run(process.execPath, ["-e", childCode], Buffer.alloc(0)), {
    code: "pdf_render_failed",
  });
  const pid = Number(await readFile("/tmp/pdf-test-child-pid", "utf8"));
  // Container init reaps orphaned descendants after the process-group kill.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await assert.rejects(stat(`/proc/${pid}`), { code: "ENOENT" });
});

test("a bridge crash kills detached-pipe descendants before capacity is reused", async () => {
  const childCode = `const {spawn}=require('node:child_process');const fs=require('node:fs');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    fs.writeFileSync('/tmp/pdf-test-crash-pid',String(child.pid));process.exit(7);`;
  await assert.rejects(runner.run(process.execPath, ["-e", childCode], Buffer.alloc(0)), {
    code: "pdf_render_failed",
  });
  const pid = Number(await readFile("/tmp/pdf-test-crash-pid", "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  await assert.rejects(stat(`/proc/${pid}`), { code: "ENOENT" });
});

for (const name of ["E1", "E2", "VOID"]) {
  test(`real memory pipeline preserves Arabic and English extraction: ${name}`, async () => {
    const fixture = fixtures().find((item) => item.name === name);
    const model = {
      ...fixture,
      invoiceDiscount: "1.25%",
      voidDateEn: fixture.voidDate,
      voidDateAr: fixture.voidReason ? fixture.dateAr : null,
      // Keep the correctness fixture below the deadline on shared CI runners;
      // worst-case 50-line performance is a separate release measurement.
      lines: fixture.lines
        .slice(0, 2)
        .map((line) => ({ ...line, discountReason: line.discountReasonAr })),
    };
    // Synthetic models only: this exercises the child path independently of the
    // deployment dump-policy gate, which correctly blocks WSL crash collectors.
    const pdf = await runner.run(
      process.execPath,
      [script, paths],
      Buffer.from(JSON.stringify(model)),
    );
    assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), "%PDF-");
    const loading = getDocument({ data: new Uint8Array(pdf) });
    try {
      const document = await loading.promise;
      let text = "";
      for (let p = 1; p <= document.numPages; p++) {
        const content = await (await document.getPage(p)).getTextContent();
        text += content.items.map((item) => item.str ?? "").join(" ") + " ";
      }
      const clean = (s) =>
        s
          .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
          .replace(/\s+/gu, " ")
          .trim();
      for (const field of [
        model.patientName,
        model.clinicAr,
        model.clinicEn,
        model.lines[0].descriptionAr,
        model.lines[0].descriptionEn,
        "1.25%",
      ])
        assert(clean(text).includes(clean(field)), "missing synthetic field");
      if (model.voidReason)
        assert(clean(text).includes(clean(model.voidDateAr)), "missing Arabic void date");
      const extracted = spawnSync("/usr/local/bin/pdftotext", ["-raw", "-", "-"], {
        input: pdf,
        env: {},
        cwd: "/",
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      assert.equal(extracted.status, 0, "pdftotext failed");
      for (const field of [model.patientName, model.clinicAr, model.clinicEn, "1.25%"])
        assert(
          clean(extracted.stdout.toString()).includes(clean(field)),
          "missing pdftotext field",
        );
    } finally {
      await loading.destroy();
    }
  });
}
