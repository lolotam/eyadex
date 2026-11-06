import assert from "node:assert/strict";
import { probeFailure } from "./probe-failure.mjs";

export function probeFailureGuards() {
  const check = (stderr, binary = "/usr/local/bin/python3") =>
    probeFailure(binary, { status: 1, stderr: Buffer.from(stderr) });
  const base = "synthetic_probe_failed:/usr/local/bin/python3:1";
  assert.equal(
    check("private source\nRuntimeError: glyph_outline_mismatch:w7r\n"),
    `${base}:glyph_outline_mismatch:w7r`,
  );
  assert.equal(
    check("RuntimeError: drawing_mutation_accepted:font_scale\r\n"),
    `${base}:drawing_mutation_accepted:font_scale`,
  );
  for (const stderr of [
    "private source",
    "RuntimeError: glyph_outline_mismatch:private source",
    "RuntimeError: glyph_outline_mismatch:w7r secret",
    "RuntimeError: drawing_mutation_accepted:unlisted",
  ])
    assert.equal(check(stderr), base);
  assert.equal(
    check("RuntimeError: glyph_outline_mismatch:w7r", "/other"),
    "synthetic_probe_failed:/other:1",
  );
  return { boundedProbeDiagnostic: true };
}
