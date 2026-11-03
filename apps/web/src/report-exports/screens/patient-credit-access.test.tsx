import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { context, renderScreen, signIn, TestLink } from "./report-screens.test-kit";
import {
  availableScreens,
  canOpenReport,
  SCREEN_NO_BRANCH,
  SCREEN_REPORTS,
} from "./report-catalogue";
import { ReportScreenPage } from "./report-screen-page";
import { R6_KEYS } from "./patient-credit-report.fixtures";

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
  context.reportId = "patient_credit";
});

it("R6 opens only with report_patients:clinic plus view:payments:clinic", () => {
  expect(canOpenReport(R6_KEYS, "patient_credit")).toBe(true);
  expect(
    canOpenReport(["view:report_patients:branch", "view:payments:clinic"], "patient_credit"),
  ).toBe(false);
  expect(
    canOpenReport(["view:report_patients:branch", "view:payments:branch"], "patient_credit"),
  ).toBe(false);
  expect(canOpenReport(["view:report_patients:clinic"], "patient_credit")).toBe(false);
  expect(canOpenReport(["view:report_own:own", "view:payments:clinic"], "patient_credit")).toBe(
    false,
  );
  expect(
    canOpenReport(["view:report_takings:clinic", "view:payments:clinic"], "patient_credit"),
  ).toBe(false);
  expect(availableScreens(R6_KEYS)).toEqual(["patient_credit", "refunds"]);
  expect(availableScreens(["view:report_patients:branch", "view:payments:branch"])).toEqual([
    "refunds",
  ]);
});

it("R10 is built; only R6 and R10 hide the branch picker", () => {
  expect((SCREEN_REPORTS as readonly string[]).includes("own_summary")).toBe(true);
  expect(SCREEN_REPORTS.filter((r) => SCREEN_NO_BRANCH.has(r))).toEqual([
    "patient_credit",
    "own_summary",
  ]);
});

it("the /clinic/reports/patient_credit route opens with real mock data", async () => {
  await signIn(personaWith(R6_KEYS));
  renderScreen(<ReportScreenPage />);
  expect(
    await screen.findByRole("heading", { name: ar.financeReports.names.patient_credit }),
  ).toBeTruthy();
  expect(screen.getAllByText(ar.financeReports.patientCredit.notice).length).toBe(2);
});

it("the route is forbidden for a branch-scoped report_patients holder", async () => {
  await signIn(personaWith(["view:report_patients:branch", "view:payments:clinic"]));
  renderScreen(<ReportScreenPage />);
  expect(screen.getByText(ar.forbidden.title)).toBeTruthy();
});

it("the route is forbidden without the covering view:payments key", async () => {
  await signIn(personaWith(["view:report_patients:clinic"]));
  renderScreen(<ReportScreenPage />);
  expect(screen.getByText(ar.forbidden.title)).toBeTruthy();
});

const PICKER_CASES: [string, string[]][] = [
  ["daily_takings", ["view:report_takings:clinic", "view:payments:clinic"]],
  [
    "period_summary",
    ["view:report_takings:clinic", "view:invoices:clinic", "view:payments:clinic"],
  ],
  ["cash_closings", ["view:report_takings:clinic", "view:cash_closings:clinic"]],
  ["by_service", ["view:report_analytics:clinic", "view:invoices:clinic"]],
  ["by_doctor", ["view:report_analytics:clinic", "view:invoices:clinic"]],
  ["outstanding", ["view:report_patients:clinic", "view:invoices:clinic"]],
];

it.each(PICKER_CASES)("%s still shows the branch picker", async (report, keys) => {
  context.reportId = report;
  await signIn(personaWith(keys));
  renderScreen(<ReportScreenPage />);
  expect(await screen.findByLabelText(ar.financeReports.filters.branch)).toBeTruthy();
});
