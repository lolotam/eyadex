import { readSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { receiptSource } from "./template.mjs";
import { bind } from "../invoice-pdf/bind.mjs";
import { orderedPages } from "../invoice-pdf/page-order.mjs";

// Unwired child entrypoint. Only the reviewed parent may supply paths and logoFile.
try {
  const config = JSON.parse(process.argv[2]);
  const deadline = Date.now() + 5000;
  const chunks = [];
  let length = 0;
  for (;;) {
    const chunk = Buffer.allocUnsafe(8192);
    const count = readSync(0, chunk, 0, chunk.length, null);
    if (!count) break;
    length += count;
    if (length > 32 * 1024 * 1024) throw new Error();
    chunks.push(chunk.subarray(0, count));
  }
  const model = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
  const run = (binary, args, input, maxBuffer) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error();
    const result = spawnSync(binary, args, {
      input,
      cwd: "/",
      env: {},
      timeout: remaining,
      killSignal: "SIGKILL",
      maxBuffer,
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (result.error || result.status !== 0) throw new Error();
    return result.stdout;
  };
  const { source, words } = receiptSource(model, { logoFile: config.logoFile ?? null });
  if (Buffer.byteLength(source) > 32 * 1024 * 1024) throw new Error();
  const intermediate = run(
    config.typst,
    [
      "compile",
      "--format",
      "pdf",
      "--ignore-system-fonts",
      "--font-path",
      config.fonts,
      "--root",
      config.root,
      "-",
      "-",
    ],
    source,
    5 * 1024 * 1024,
  );
  const document = JSON.parse(run(config.qpdf, ["to-json"], intermediate, 32 * 1024 * 1024));
  const count = orderedPages(document).length;
  bind(document, words);
  if (orderedPages(document).length !== count) throw new Error();
  const corrected = JSON.stringify(document);
  if (Buffer.byteLength(corrected) > 32 * 1024 * 1024) throw new Error();
  const final = run(config.qpdf, ["from-json"], corrected, 5 * 1024 * 1024);
  if (final.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error();
  const checked = JSON.parse(run(config.qpdf, ["to-json"], final, 32 * 1024 * 1024));
  if (orderedPages(checked).length !== count) throw new Error();
  process.stdout.write(final);
} catch {
  // Native errors can contain document text; return no bytes and no stderr details.
  process.exitCode = 1;
}
