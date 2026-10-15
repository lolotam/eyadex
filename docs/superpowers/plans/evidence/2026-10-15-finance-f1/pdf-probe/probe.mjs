// Disposable 8g feasibility probe. Synthetic data only. Runs inside node:24-alpine.
// Usage: node probe.mjs <typst-binary> <fonts-dir> <out-dir>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [typst, fonts, out] = process.argv.slice(2);

import { documentFor } from "./doc.mjs";

function compile(doc, format) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(
      typst,
      ARGS(format),
      { env: {}, cwd: "/", stdio: ["pipe", "pipe", "pipe"] },
    );
    const chunks = [];
    let errBytes = 0;
    let stderr = "";
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => {
      errBytes += c.length;
      stderr += c.toString();
    });
    child.on("close", (code, signal) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ code, signal, ms, out: Buffer.concat(chunks), errBytes, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(doc);
  });
}

const ARGS = (format) => ["compile", "--format", format, "--ignore-system-fonts", "--font-path", fonts, "--root", "/probe-root", "-", "-"];
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];

const report = { argvHasData: false, runs: {} };
for (const lines of [1, 20, 50]) {
  const doc = documentFor(lines);
  const times = [];
  let last;
  for (let i = 0; i < 12; i++) {
    last = await compile(doc, "pdf");
    if (last.code !== 0) break;
    times.push(last.ms);
  }
  report.runs[lines] = {
    exit: last.code,
    signal: last.signal,
    stderrBytes: last.errBytes,
    stderr: last.code === 0 ? "" : last.stderr.slice(0, 400),
    pdfBytes: last.out.length,
    pdfMagic: last.out.subarray(0, 5).toString(),
    coldMs: times[0]?.toFixed(1),
    warmP50Ms: times.length > 2 ? pct(times.slice(1), 50).toFixed(1) : null,
    warmP95Ms: times.length > 2 ? pct(times.slice(1), 95).toFixed(1) : null,
  };
  if (lines === 50 && last.code === 0) writeFileSync(`${out}/probe-50.pdf`, last.out);
}
const png = await compile(documentFor(3), "png");
report.png = { exit: png.code, bytes: png.out.length, stderr: png.code === 0 ? "" : png.stderr.slice(0, 400) };
if (png.code === 0) writeFileSync(`${out}/probe-3.png`, png.out);
// The argv never carries the model: check the literal patient marker is absent from it.
report.argvHasData = ["pdf", "png"].some((f) => ARGS(f).join(" ").includes("مراجع"));
console.log(JSON.stringify(report, null, 2));
