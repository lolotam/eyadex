import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt } from "./medical-test-kit";

beforeEach(() => resetMockData());

// Codex 4241493941: the mock answers as the API's `searchIcd10` (queries/icd10-search.ts) over its
// demo slice — code prefixes with the dots dropped, title words, then the API's order.
describe("the mock ICD-10 search", () => {
  it.each([
    ["a dotless code finds the dotted one", "F411", ["F41.1"]],
    ["a lower-case dotted code", "f41.1", ["F41.1"]],
    ["a category prefix, by code, the query trimmed", " F41 ", ["F41.0", "F41.1", "F41.9"]],
    ["a title starting with the word comes first", "anxiety", ["F41.9", "F41.0", "F41.1"]],
    ["every word, anywhere in the title", "unspecified disorder", ["F32.9", "F41.9", "F43.10"]],
    // Titles containing an "f", none starting with one, so by code; F32.0 ("mild") is not among them.
    [
      "one letter is a title word, not a code prefix",
      "F",
      [
        "E78.5",
        "F32.9",
        "F41.9",
        "F43.10",
        "F90.0",
        "G43.909",
        "J06.9",
        "J45.909",
        "K21.9",
        "L20.9",
        "M54.50",
        "N39.0",
        "O80",
        "R51.9",
        "Z00.00",
      ],
    ],
  ])("%s: %s", async (_case, q, codes) => {
    const { items } = await api.medical.searchIcd10(doctorAt(0), q);
    expect(items.map((i) => i.code)).toEqual(codes);
  });
});
