import { describe, expect, it } from "vitest";

import {
  parseFrozenReportExportParams,
  type FrozenReportExportParams,
} from "../finance-reports-export.ts";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Homomorphic mapping keeps `readonly`; `-readonly` strips it. Equal means the field was mutable. */
type PropertyIsReadonly<T, K extends keyof T> =
  Equal<{ [P in K]: T[P] }, { -readonly [P in K]: T[P] }> extends true ? false : true;

type Assert<T extends true> = T;

type FrozenFieldsAreReadonly = Assert<
  PropertyIsReadonly<FrozenReportExportParams, "from"> extends true
    ? PropertyIsReadonly<FrozenReportExportParams, "to"> extends true
      ? PropertyIsReadonly<FrozenReportExportParams, "language"> extends true
        ? PropertyIsReadonly<FrozenReportExportParams, "branchIds"> extends true
          ? PropertyIsReadonly<FrozenReportExportParams, "groupBy"> extends true
            ? "push" extends keyof FrozenReportExportParams["branchIds"]
              ? false
              : true
            : false
          : false
        : false
      : false
    : false
>;

const EAST = "11111111-1111-4111-8111-111111111111";
const WEST = "22222222-2222-4222-8222-222222222222";
const WITHIN = { from: "2024-01-01", to: "2026-12-31" };
const TOO_LONG = { from: "2024-01-01", to: "2027-01-01" };

const frozen = (extra: Record<string, unknown> = {}) => ({
  ...WITHIN,
  language: "en" as const,
  branchIds: [EAST],
  groupBy: "day" as const,
  ...extra,
});

describe("parseFrozenReportExportParams", () => {
  it("keeps an explicit 1096-day range, language, group, and empty branches", () => {
    const empty = frozen({ branchIds: [], language: "ar", groupBy: "month" });
    expect(parseFrozenReportExportParams("period_summary", "xlsx", empty)).toEqual({
      ...WITHIN,
      language: "ar",
      branchIds: [],
      groupBy: "month",
    });
    expect(parseFrozenReportExportParams("daily_takings", "csv", frozen())).toEqual(frozen());
  });

  it("refuses a 1097-day range, a backwards range, and a non-calendar day", () => {
    expect(parseFrozenReportExportParams("daily_takings", "csv", frozen(TOO_LONG))).toBeNull();
    expect(
      parseFrozenReportExportParams(
        "daily_takings",
        "csv",
        frozen({ from: "2026-02-02", to: "2026-02-01" }),
      ),
    ).toBeNull();
    const ungrouped = ({ groupBy: _groupBy, ...rest }: ReturnType<typeof frozen>) => rest;
    for (const from of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31"]) {
      expect(
        parseFrozenReportExportParams("by_service", "csv", { ...ungrouped(frozen()), from }),
      ).toBeNull();
    }
  });

  it("requires stored groupBy for R1 and R2 and rejects it elsewhere", () => {
    const { groupBy: _groupBy, ...missing } = frozen();
    expect(parseFrozenReportExportParams("daily_takings", "csv", missing)).toBeNull();
    expect(parseFrozenReportExportParams("period_summary", "xlsx", missing)).toBeNull();
    const ungrouped = ({ groupBy: _groupBy, ...rest }: ReturnType<typeof frozen>) => rest;
    expect(parseFrozenReportExportParams("by_service", "csv", frozen())).toBeNull();
    expect(
      parseFrozenReportExportParams("own_summary", "csv", frozen({ groupBy: "month" })),
    ).toBeNull();
    expect(parseFrozenReportExportParams("cash_closings", "csv", ungrouped(frozen()))).toEqual({
      ...WITHIN,
      language: "en",
      branchIds: [EAST],
    });
  });

  it("rejects missing, null, or extra fields and does not mutate the input", () => {
    const branchIds = [WEST, EAST];
    const input = frozen({ branchIds, language: "ar" });
    const before = structuredClone(input);
    expect(parseFrozenReportExportParams("daily_takings", "csv", input)?.branchIds).toEqual([
      WEST,
      EAST,
    ]);
    expect(input).toEqual(before);
    expect(input.branchIds).toBe(branchIds);
    expect(parseFrozenReportExportParams("daily_takings", "csv", null)).toBeNull();
    expect(
      parseFrozenReportExportParams("daily_takings", "csv", frozen({ language: undefined })),
    ).toBeNull();
    expect(
      parseFrozenReportExportParams("daily_takings", "csv", frozen({ branchIds: undefined })),
    ).toBeNull();
    expect(
      parseFrozenReportExportParams("daily_takings", "csv", frozen({ branchIds: null })),
    ).toBeNull();
    expect(
      parseFrozenReportExportParams("daily_takings", "csv", frozen({ branchIds: EAST })),
    ).toBeNull();
    for (const extra of ["filter", "cursor", "limit", "branchId", "report", "format"]) {
      expect(
        parseFrozenReportExportParams("daily_takings", "csv", frozen({ [extra]: "x" })),
      ).toBeNull();
    }
  });

  it("freezes the parsed object and its branch array, and the type forbids both writes", () => {
    const branchIds = [WEST, EAST];
    const input = frozen({ branchIds, language: "ar" });
    const before = structuredClone(input);
    const parsed = parseFrozenReportExportParams("daily_takings", "csv", input);
    const fieldsAreReadonly: FrozenFieldsAreReadonly = true;
    expect(fieldsAreReadonly).toBe(true);
    expect(parsed).not.toBeNull();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.branchIds)).toBe(true);
    expect(() => {
      (parsed as { from: string }).from = "2024-01-02";
    }).toThrow(TypeError);
    expect(() => {
      (parsed as { branchIds: readonly string[] }).branchIds = [];
    }).toThrow(TypeError);
    expect(() => {
      (parsed?.branchIds as string[]).push(EAST);
    }).toThrow(TypeError);
    expect(parsed).toEqual({ ...WITHIN, language: "ar", branchIds: [WEST, EAST], groupBy: "day" });
    expect(input).toEqual(before);
    expect(input.branchIds).toBe(branchIds);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.branchIds)).toBe(false);
  });
});
