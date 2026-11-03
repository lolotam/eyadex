import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { REPORT_IDS } from "@eyadex/contracts/finance-reports";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { context, renderScreen, signIn, TestLink } from "./report-screens.test-kit";
import { availableScreens, canOpenReport, SCREEN_REPORTS } from "./report-catalogue";
import { ReportScreenPage } from "./report-screen-page";
import { ownAnswer, R10_KEYS } from "./own-summary-report.fixtures";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: context.persona, ready: true }),
  useSession: () => ({ session: context.session, isLoading: false, error: null }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: TestLink,
  useParams: () => ({ reportId: context.reportId }),
}));

beforeEach(() => {
  resetMockData();
  context.reportId = "own_summary";
});

const opensR10 = (keys: string[]) => canOpenReport(keys, "own_summary");

it("R10 opens with report_own:own plus view:invoices:own and with nothing less", () => {
  expect(opensR10(R10_KEYS)).toBe(true);
  expect(opensR10(["view:report_own:own"])).toBe(false);
  expect(opensR10(["view:invoices:own"])).toBe(false);
});

it("only the own scope opens R10: branch or clinic keys never stand in", () => {
  for (const scope of ["branch", "clinic"]) {
    expect(opensR10([`view:report_own:${scope}`, `view:invoices:${scope}`])).toBe(false);
    expect(opensR10([`view:report_own:${scope}`, "view:invoices:own"])).toBe(false);
    expect(opensR10(["view:report_own:own", `view:invoices:${scope}`])).toBe(false);
  }
  for (const resource of ["report_takings", "report_analytics", "report_patients"])
    for (const scope of ["branch", "clinic"])
      expect(
        opensR10([
          `view:${resource}:${scope}`,
          `view:invoices:${scope}`,
          `view:payments:${scope}`,
          `view:cash_closings:${scope}`,
        ]),
      ).toBe(false);
});

it("report_own never opens R1-R9; own plus clinic keys show both sets", () => {
  const wide = ["view:invoices:clinic", "view:payments:clinic", "view:cash_closings:clinic"];
  for (const report of REPORT_IDS.filter((r) => r !== "own_summary"))
    expect(canOpenReport(["view:report_own:own", "view:invoices:own", ...wide], report)).toBe(
      false,
    );
  expect(availableScreens(R10_KEYS)).toEqual(["own_summary"]);
  expect(availableScreens([...R10_KEYS, "view:report_takings:clinic", ...wide])).toEqual([
    "daily_takings",
    "period_summary",
    "cash_closings",
    "own_summary",
  ]);
});

it("every report id now has a screen", () => {
  expect([...SCREEN_REPORTS].sort()).toEqual([...REPORT_IDS].sort());
});

it("the /clinic/reports/own_summary route opens for R10 keys and is forbidden otherwise", async () => {
  const api = await signIn(personaWith(R10_KEYS));
  vi.spyOn(api.reports, "ownSummary").mockResolvedValue(ownAnswer([], "0"));
  renderScreen(<ReportScreenPage />);
  expect(await screen.findByText(ar.financeReports.states.empty)).toBeTruthy();
  expect(screen.getByRole("heading", { name: ar.financeReports.names.own_summary })).toBeTruthy();
  document.body.innerHTML = "";
  await signIn(personaWith(["view:report_own:own"]));
  renderScreen(<ReportScreenPage />);
  expect(screen.getByText(ar.forbidden.title)).toBeTruthy();
  document.body.innerHTML = "";
  await signIn(personaWith(["view:report_own:branch", "view:invoices:branch"]));
  renderScreen(<ReportScreenPage />);
  expect(screen.getByText(ar.forbidden.title)).toBeTruthy();
});
