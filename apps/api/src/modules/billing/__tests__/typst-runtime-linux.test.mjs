import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import test, { mock } from "node:test";
import { TypstInvoicePdfRenderer as SharedRenderer } from "@eyadex/invoice-pdf/runtime";
import { TypstInvoicePdfRenderer as ApiRenderer } from "../rendering/typst-invoice-pdf.ts";
import { fixtures } from "/probe/invoice/fixtures.mjs";

test("both entrypoints render a synthetic model through the real native pipeline", async () => {
  // Test-only policy seam: no host policy change or production activation.
  const read = fs.readFileSync;
  const spy = mock.method(fs, "readFileSync", (path, ...args) => {
    if (path === "/proc/self/limits") return "Max core file size 0 0 bytes";
    if (path === "/proc/sys/kernel/core_pattern") return "core";
    return read(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    const paths = {
      typst: "/opt/typst-x86_64-unknown-linux-musl/typst",
      qpdf: "/usr/local/bin/qpdf-memory",
      fonts: "/fonts",
      root: "/pdf-root",
    };
    const script = fileURLToPath(
      new URL("../../../../assets/invoice-pdf/render.mjs", import.meta.url),
    );
    for (const renderer of [new SharedRenderer({ ...paths, script }), new ApiRenderer(paths)]) {
      const pdf = await renderer.render(fixtures()[0]);
      assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), "%PDF-");
    }
  } finally {
    spy.mock.restore();
    syncBuiltinESMExports();
  }
});
