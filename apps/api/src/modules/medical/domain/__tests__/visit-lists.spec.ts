import { describe, expect, it } from "vitest";

import { icd10Terms } from "../icd10.ts";
import {
  codesOf,
  diagnosisItem,
  hasUnknownCode,
  prescriptionItem,
  sameList,
} from "../visit-lists.ts";

describe("diagnoses (P2-8)", () => {
  const coded = diagnosisItem({
    kind: "icd10",
    code: "F41.1",
    text: "Generalized anxiety disorder",
  });
  const free = diagnosisItem({ kind: "text", text: "قلق" });

  it("a free-text diagnosis has no code", () => {
    expect(free).toEqual({ kind: "text", code: null, text: "قلق" });
    expect(codesOf([coded, free, coded])).toEqual(["F41.1"]);
  });

  it("icd10_unknown when a code is missing from the billable set", () => {
    expect(hasUnknownCode([coded, free], new Set(["F41.1"]))).toBe(false);
    expect(hasUnknownCode([coded], new Set())).toBe(true);
    expect(hasUnknownCode([free], new Set())).toBe(false);
  });

  it("the same list in the same order is unchanged; another order is a change", () => {
    expect(sameList([coded, free], [{ ...coded }, { ...free }])).toBe(true);
    expect(sameList([coded, free], [free, coded])).toBe(false);
    expect(sameList([coded], [coded, free])).toBe(false);
    expect(sameList([], [])).toBe(true);
  });
});

describe("prescription items (P2-9)", () => {
  it("a blank note is null; the other fields stay as written", () => {
    const item = { medicine: "Paracetamol", dose: "", frequency: "3x", duration: "5d" };
    expect(prescriptionItem({ ...item, note: "  " })).toEqual({ ...item, note: null });
  });
});

describe("icd10Terms (P2-F1)", () => {
  it("a code-like word searches by prefix without the dot, upper-cased", () => {
    expect(icd10Terms("f41.1")).toEqual({ codePrefix: "F411", words: ["f41.1"] });
    expect(icd10Terms(" I10 ")).toEqual({ codePrefix: "I10", words: ["i10"] });
  });

  it("a FY2027 code with a letter second is code-like; a word without an early digit is not", () => {
    expect(icd10Terms("qa0.01")).toEqual({ codePrefix: "QA001", words: ["qa0.01"] });
    expect(icd10Terms("flu")).toEqual({ codePrefix: null, words: ["flu"] });
  });

  it("words search the title only", () => {
    expect(icd10Terms("Generalized  Anxiety")).toEqual({
      codePrefix: null,
      words: ["generalized", "anxiety"],
    });
  });
});
