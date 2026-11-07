import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { orderedPages } from "../../apps/api/assets/invoice-pdf/page-order.mjs";

function pdf(streams, metadata = "") {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${metadata} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
    ...streams.map((data) =>
      Buffer.concat([
        Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`),
        data,
        Buffer.from("\nendstream"),
      ]),
    ),
  ];
  let output = Buffer.from("%PDF-1.7\n");
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(output.length);
    output = Buffer.concat([
      output,
      Buffer.from(`${index + 1} 0 obj\n`),
      Buffer.from(object),
      Buffer.from("\nendobj\n"),
    ]);
  }
  const xref = output.length;
  return Buffer.concat([
    output,
    Buffer.from(
      `xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
        offsets
          .slice(1)
          .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
          .join("") +
        `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  ]);
}

function verify(input, accepted = false, timeout = 5000) {
  const result = spawnSync("/usr/local/bin/qpdf-memory", ["verify"], {
    input,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    env: {},
  });
  assert.ifError(result.error);
  assert.equal(result.status, accepted ? 0 : 2);
  assert(["", "pdf_process_failed\n"].includes(result.stderr.toString()));
  if (!accepted) assert.equal(result.stdout.length, 0);
  return result.stdout;
}

const valid = pdf([deflateSync("q\nQ\n")]);
test("verify emits page metadata without decoded stream payload", () => {
  const metadata = JSON.parse(verify(valid, true));
  assert.equal(orderedPages(metadata).length, 1);
  assert(!verify(valid, true).includes(Buffer.from('"data"')));
});

test("verify rejects malformed Flate, truncation and repair warnings without stdout", () => {
  verify(pdf([Buffer.from("not-zlib")]));
  verify(valid.subarray(0, 160));
  verify(Buffer.from(valid.toString().replace(/startxref\n\d+/, "startxref\n0")));
});

test("verify bounds aggregate decoded bytes including unreferenced streams", () => {
  const stream = deflateSync(Buffer.alloc(17 * 1024 * 1024, 32));
  verify(pdf([stream, stream]));
});

test("verify rejects oversized PDF input", () => {
  verify(Buffer.alloc(5 * 1024 * 1024 + 1, 32));
});

test("verify bounds metadata during serialization with zero partial stdout", () => {
  const input = pdf(
    [deflateSync("")],
    `/Bomb ${"[".repeat(100)}${"0 ".repeat(300_000)}${"]".repeat(100)}`,
  );
  assert(input.length < 5 * 1024 * 1024);
  // Source-correctness stress probe uses the approved local 60s budget only.
  // The production pipeline's shared 5s deadline is unchanged.
  verify(input, false, 60_000);
});
