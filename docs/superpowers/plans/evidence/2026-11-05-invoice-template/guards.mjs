import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { bind } from "./bind.mjs";
import { fixtures } from "./fixtures.mjs";
import { invoiceSource } from "./template.mjs";
import { validateBindings, expectedOrder } from "./structure.mjs";

function jsonOf(source) {
  const raw = spawnSync(
    "/opt/typst-x86_64-unknown-linux-musl/typst",
    ["compile", "--ignore-system-fonts", "--font-path", "/fonts", "-", "-"],
    { input: source, maxBuffer: 32 * 1024 * 1024 },
  );
  assert.equal(raw.status, 0, "synthetic guard compile failed");
  const decoded = spawnSync("/usr/local/bin/qpdf-memory", ["to-json"], {
    input: raw.stdout,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(decoded.status, 0, "synthetic guard decode failed");
  return JSON.parse(decoded.stdout);
}
export function guardTests() {
  const model = fixtures([]).find((m) => m.name === "E3");
  const original = invoiceSource(model);
  const lines = original.source.split("\n"),
    discountLine = lines.findIndex((line) => line.startsWith("#par[") && line.includes("Discount"));
  assert(discountLine >= 0);
  lines.splice(discountLine, 1);
  assert.throws(() => bind(jsonOf(lines.join("\n")), original.words), /allocated word missing/);
  const footer = original.source.split("footer:align(center)[")[1].split(" / ")[0];
  const duplicate = original.source.replace(
    "footer:align(center)[",
    "footer:align(center)[" + footer + " ",
  );
  assert.throws(
    () =>
      validateBindings(jsonOf(duplicate), original.words, original.roles, original.fieldRecords),
    /duplicate field instance/,
  );
  const repeated = invoiceSource(fixtures([]).find((m) => m.name === "FIFTY"));
  const reversed = repeated.source.replace(
    "#let field(parts,lang,weight,limitCap)=context {",
    '#let field(parts,lang,weight,limitCap)=context {\n let parts=if counter(page).get().first()>1 and parts.len()==2 and parts.at(0).at(1)=="سعر" { parts.rev() } else {parts}\n',
  );
  assert.notEqual(reversed, repeated.source);
  assert.throws(
    () => validateBindings(jsonOf(reversed), repeated.words, repeated.roles, repeated.fieldRecords),
    /repeated field order/,
  );
  const swappedCells = [...repeated.headerCells];
  [swappedCells[0], swappedCells[1]] = [swappedCells[1], swappedCells[0]];
  const swappedHeader = repeated.source.replace(
    `table.header(${repeated.headerCells.join(",")})`,
    `table.header(${swappedCells.join(",")})`,
  );
  assert.notEqual(swappedHeader, repeated.source);
  const verifyRepeated = (source) =>
    validateBindings(
      jsonOf(source),
      repeated.words,
      repeated.roles,
      repeated.fieldRecords,
      repeated.repeatedOrder,
    );
  assert.throws(() => verifyRepeated(swappedHeader), /repeated role order changed/);
  const start = repeated.source.indexOf("footer:align(center)[") + "footer:align(center)[".length;
  const end = repeated.source.indexOf("\n  ])", start);
  const footerParts = repeated.source.slice(start, end).split("#h(8pt) ");
  assert.equal(footerParts.length, 2);
  const swappedFooter =
    repeated.source.slice(0, start) +
    footerParts[1] +
    "#h(8pt) " +
    footerParts[0] +
    repeated.source.slice(end);
  assert.throws(() => verifyRepeated(swappedFooter), /repeated role order changed/);
  const originalDocument = jsonOf(repeated.source),
    shuffled = structuredClone(originalDocument);
  shuffled.qpdf[1] = Object.fromEntries(Object.entries(shuffled.qpdf[1]).reverse());
  assert.deepEqual(
    expectedOrder(shuffled, repeated.words, repeated.roles, repeated.sourceOrder),
    expectedOrder(originalDocument, repeated.words, repeated.roles, repeated.sourceOrder),
  );
  validateBindings(
    shuffled,
    repeated.words,
    repeated.roles,
    repeated.fieldRecords,
    repeated.repeatedOrder,
  );
  for (const patientName of [
    "مبنى\u202e12",
    "مبنى\u200d١٢",
    "ABC\u202e123",
    "ABC\t123",
    "ABC\n123",
    "ABC\r123",
  ]) {
    assert.throws(() => {
      const candidate = invoiceSource({ ...model, patientName });
      bind(jsonOf(candidate.source), candidate.words);
    }, /unsupported_format_character/);
  }
  const unsupported = invoiceSource({ ...model, patientName: "مبنى漢" });
  assert.throws(() => bind(jsonOf(unsupported.source), unsupported.words), /unsupported_script/);
  for (const [patientName, error] of [
    ["مبنى<12>", /unsupported_mixed_angle_bracket/],
    ["مبنىﬃ", /unsupported_compatibility_ligature/],
  ]) {
    const candidate = invoiceSource({ ...model, patientName });
    assert.throws(() => bind(jsonOf(candidate.source), candidate.words), error);
  }
  return {
    missingRepeatedFieldRejected: true,
    repeatedHeaderReorderingRejected: true,
    wholeHeaderSwapRejected: true,
    wholeFooterSwapRejected: true,
    objectAllocationOrderIgnored: true,
    formatControlsRejected: 6,
    unsupportedScriptRejected: true,
    knownExtractorTextLossRejected: 2,
    duplicateFieldRejected: true,
  };
}
