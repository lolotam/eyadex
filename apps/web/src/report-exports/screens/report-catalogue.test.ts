import { beforeEach, expect, it } from "vitest";
import { as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api } from "@/shared/api/mock/mock-report-test-kit";
import { availableScreens, canOpenReport, openableReports } from "./report-catalogue";

beforeEach(() => resetMockData());
const keysOf = async (kind: "receptionist" | "doctor" | "clinic_admin") =>
  (await api.session.getContext(as(kind))).permissions;

it("a receptionist opens R1, R2 and R9 only, and sees the R1 and R2 cards", async () => {
  const keys = await keysOf("receptionist");
  expect(openableReports(keys)).toEqual(["daily_takings", "period_summary", "cash_closings"]);
  expect(availableScreens(keys)).toEqual(["daily_takings", "period_summary"]);
});

it("report_own never opens R5, whatever its own invoice key", async () => {
  expect(canOpenReport(["view:report_own:own", "view:invoices:own"], "outstanding")).toBe(false);
  expect(canOpenReport(["view:report_own:own", "view:invoices:clinic"], "outstanding")).toBe(false);
  expect(canOpenReport(await keysOf("doctor"), "outstanding")).toBe(false);
});

it("R1 needs a covering payments key and R2 needs invoices and payments", () => {
  expect(canOpenReport(["view:report_takings:branch"], "daily_takings")).toBe(false);
  expect(
    canOpenReport(["view:report_takings:branch", "view:payments:branch"], "daily_takings"),
  ).toBe(true);
  expect(
    canOpenReport(["view:report_takings:branch", "view:payments:branch"], "period_summary"),
  ).toBe(false);
  expect(
    canOpenReport(
      ["view:report_takings:clinic", "view:payments:clinic", "view:invoices:clinic"],
      "period_summary",
    ),
  ).toBe(true);
});

it("a caller with no report key gets no card", () => {
  expect(availableScreens([])).toEqual([]);
});
