import { describe, expect, it } from "vitest";

import { parseIcd10OrderFile } from "../../modules/medical/index.ts";
import { icd10LoadScript } from "../icd10-load-script.ts";

// R2-8: a few lines in the CDC order file's fixed-width layout (no download): order number, code, the
// billable flag, the short title padded to 60, the long title.
const row = (order: number, code: string, flag: 0 | 1, short: string, long = short) =>
  `${String(order).padStart(5, "0")} ${code.padEnd(7)} ${flag} ${short.padEnd(60)} ${long}`;

const SAMPLE = [
  row(1, "F41", 0, "Other anxiety disorders"),
  row(
    2,
    "F410",
    1,
    "Panic disorder without agoraphobia",
    "Panic disorder [episodic paroxysmal anxiety]",
  ),
  row(3, "F411", 1, "Generalized anxiety disorder"),
  row(4, "I10", 1, "Essential (primary) hypertension"),
  row(
    5,
    "S0300XA",
    1,
    "Dislocation of jaw, unsp side, init",
    "Dislocation of jaw, unspecified side, initial encounter",
  ),
  row(
    6,
    "Z630",
    1,
    "Problems in relationship with spouse or partner",
    "Problems in relationship with spouse's partner",
  ),
].join("\r\n");

describe("parseIcd10OrderFile (R2-8)", () => {
  const rows = parseIcd10OrderFile(`${SAMPLE}\r\n\r\n`);

  it("keeps a 3-character header without a dot, not billable", () => {
    expect(rows[0]).toEqual({ code: "F41", titleEn: "Other anxiety disorders", billable: false });
  });

  it("keeps a billable 3-character code without a dot", () => {
    expect(rows[3]).toEqual({
      code: "I10",
      titleEn: "Essential (primary) hypertension",
      billable: true,
    });
  });

  it("puts the dot after the third character of longer codes, with the long title", () => {
    expect(rows.map((r) => r.code)).toEqual(["F41", "F41.0", "F41.1", "I10", "S03.00XA", "Z63.0"]);
    expect(rows[1]!.titleEn).toBe("Panic disorder [episodic paroxysmal anxiety]");
    expect(rows[4]!.titleEn).toBe("Dislocation of jaw, unspecified side, initial encounter");
  });

  it("accepts the FY2027 codes whose second character is a letter", () => {
    const qa = parseIcd10OrderFile(
      row(1, "QA00101", 1, "Neurodev disord", "Neurodevelopmental disorder"),
    );
    expect(qa).toEqual([
      { code: "QA0.0101", titleEn: "Neurodevelopmental disorder", billable: true },
    ]);
  });

  it("stops on a line that is not an order-file row, naming the line only", () => {
    expect(() => parseIcd10OrderFile(`${row(1, "F41", 0, "x")}\nnot a row`)).toThrow(
      "icd10: line 2 is not an order-file row",
    );
    expect(() => parseIcd10OrderFile(row(1, "F41", 0, "x").replace(" 0 ", " 7 "))).toThrow(
      RangeError,
    );
  });
});

describe("icd10LoadScript", () => {
  const script = icd10LoadScript(parseIcd10OrderFile(SAMPLE));

  it("upserts every code by code in one transaction, release FY2027", () => {
    expect(script.startsWith("SET standard_conforming_strings = on;\nBEGIN;\n")).toBe(true);
    expect(script.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(script).toContain("('F41', 'Other anxiety disorders', false, 'FY2027')");
    expect(script).toContain("('F41.1', 'Generalized anxiety disorder', true, 'FY2027')");
    expect(script).toContain("ON CONFLICT (code) DO UPDATE SET title_en = EXCLUDED.title_en");
  });

  it("retires every billable code, of any release, inside the transaction before the first upsert", () => {
    const retire = "UPDATE icd10_codes SET billable = false WHERE billable;";
    const at = script.indexOf(retire);
    expect(at).toBeGreaterThan(script.indexOf("BEGIN;"));
    expect(at).toBeLessThan(script.indexOf("INSERT INTO icd10_codes"));
    // A corrected file of the same release retires what it drops too: no release in the predicate.
    expect(icd10LoadScript([], "FY2027")).toContain(retire);
  });

  it("doubles a quote inside a title", () => {
    expect(script).toContain("'Problems in relationship with spouse''s partner'");
  });

  it("splits a large file into batches of one thousand rows", () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({
      code: `A${String(i).padStart(4, "0")}`,
      titleEn: "t",
      billable: true,
    }));
    expect(icd10LoadScript(many).match(/INSERT INTO icd10_codes/g)).toHaveLength(3);
  });
});
