import { describe, expect, it } from "vitest";
import { z } from "zod";

// GHSA-mrhx-c7xc-m3w5: a bounded array must reject on size before walking elements.
// Counts visits so that cap is told apart from ordinary element validation.
// The installed Zod 4 package is the subject; nothing here mocks it or pins a version string.
function countingString() {
  let visits = 0;
  const element = z.preprocess((value) => {
    visits += 1;
    return value;
  }, z.string());
  return {
    element,
    visits: () => visits,
  };
}

const TWENTY = Array.from({ length: 20 }, () => "ok");

describe("Zod 4 array size bound", () => {
  it("rejects an oversized bounded array before any element preprocessor runs", () => {
    const counted = countingString();
    const result = z.array(counted.element).max(2).safeParse(TWENTY);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([expect.objectContaining({ code: "too_big", path: [] })]);
    }
    expect(counted.visits()).toBe(0);
  });

  it("parses an array that sits exactly on the bound", () => {
    const counted = countingString();
    const parsed = z.array(counted.element).max(2).parse(["a", "b"]);

    expect(parsed).toEqual(["a", "b"]);
    expect(counted.visits()).toBe(2);
  });

  it("still rejects an invalid element when the array is under the bound", () => {
    const counted = countingString();
    const result = z.array(counted.element).max(2).safeParse([1]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.code === "too_big")).toBe(false);
      expect(result.error.issues.some((issue) => issue.code === "invalid_type")).toBe(true);
    }
    expect(counted.visits()).toBeGreaterThan(0);
  });
});
