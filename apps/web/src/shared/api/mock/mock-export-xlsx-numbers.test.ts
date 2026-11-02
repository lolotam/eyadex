import { describe, expect, it } from "vitest";
import { count, date, money, row, text } from "./mock-export-fixtures.test-kit";
import { cellValues, elements, xlsxArtifact, xlsxRefused } from "./mock-export-xlsx.test-kit";

// Count precision and formula guards, split from the artifact suite by responsibility.
describe("XLSX numbers and formula guards", () => {
  it.each([0, 4n, "15", 999_999_999_999_999, 999_999_999_999_999n])(
    "stores 15-digit-or-less count %s as an exact number",
    async (value) => {
      const artifact = await xlsxArtifact("by_service", [
        row("by_service", { quantity: count(value) }),
      ]);
      const sheet = artifact.sheets[0];
      if (!sheet) throw new Error("Missing sheet");
      const cell = elements(sheet, "c").find((item) => item.getAttribute("r") === "C2");
      expect(cell?.getAttribute("t")).toBe("n");
      expect(cell?.textContent).toBe(value.toString());
      expect(cell && elements(cell, "is")).toStrictEqual([]);
    },
  );

  it.each([
    "1000000000000000",
    1_234_567_890_123_457n,
    Number.MAX_SAFE_INTEGER,
    "9007199254740992",
    9007199254740993n,
    "123456789012345678901234",
  ])("stores 16-digit count %s as exact text Excel cannot round", async (value) => {
    const artifact = await xlsxArtifact("by_service", [
      row("by_service", { quantity: count(value) }),
    ]);
    const sheet = artifact.sheets[0];
    if (!sheet) throw new Error("Missing sheet");
    const cell = elements(sheet, "c").find((item) => item.getAttribute("r") === "C2");
    expect(cell?.getAttribute("t")).toBe("inlineStr");
    expect(cell?.getAttribute("s")).toBe("1");
    expect(cell?.textContent).toBe(value.toString());
  });

  it.each([-1n, "-1", "01", 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "refuses unsafe count %s with no artifact",
    async (value) => {
      await xlsxRefused({
        report: "by_service",
        language: "en",
        rows: [row("by_service"), row("by_service", { quantity: count(value) })],
      });
    },
  );

  it.each(["=", "+", "-", "@", "\t", "\n", "\r"])(
    "reuses prepared formula guard for text/date/currency %j",
    async (trigger) => {
      const value = `${trigger}synthetic`;
      const artifact = await xlsxArtifact("own_summary", [
        row("own_summary", { period: date(value), currency: text(value) }),
      ]);
      const sheet = artifact.sheets[0];
      if (!sheet) throw new Error("Missing sheet");
      expect(cellValues(sheet)[1]).toStrictEqual([`'${value}`, "12.500", `'${value}`]);
    },
  );
});
