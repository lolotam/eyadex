import { screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReportId } from "@eyadex/contracts/finance-reports";
import { ApiError } from "@/shared/api/api-error";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { freeLine, issue, personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { context, renderScreen, signIn, TestLink } from "./report-screens.test-kit";
import { availableScreens, canOpenReport } from "./report-catalogue";
import { formatReportMinor, sumMinor } from "./report-money";
import { ReportScreenPage } from "./report-screen-page";
import { taxLast, type ByDoctorResponse, type ByServiceResponse } from "./revenue-rows";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: context.persona, ready: true }),
  useSession: () => ({ session: context.session, isLoading: false, error: null }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: TestLink,
  useParams: () => ({ reportId: context.reportId }),
}));

const F = ar.financeReports;
beforeEach(() => resetMockData());

// Synthetic ids only: nothing here resembles a real identifier.
const SERVICE_A = "00000000-0000-7000-8000-0000000000c1";
const DOCTOR_A = "00000000-0000-7000-8000-0000000000d1";
const ANALYTICS = ["view:report_analytics:clinic", "view:invoices:clinic"];

// The tax row arrives first on purpose: the screen must still show it last.
const serviceData: ByServiceResponse = {
  rows: [
    {
      kind: "tax",
      serviceId: null,
      name: "x",
      lineCount: 0,
      quantity: 0,
      amountMinor: "1250",
      currency: "KWD",
    },
    {
      kind: "service",
      serviceId: SERVICE_A,
      name: "Service A",
      lineCount: 3,
      quantity: 4,
      amountMinor: "20000",
      currency: "KWD",
    },
    {
      kind: "free",
      serviceId: null,
      name: "x",
      lineCount: 2,
      quantity: 2,
      amountMinor: "5000",
      currency: "KWD",
    },
  ],
  totals: {
    lineCount: 5,
    quantity: 6,
    billedMinor: "25000",
    taxMinor: "1250",
    totalMinor: "26250",
  },
  currency: "KWD",
  currencyExponent: 3,
};
const doctorData: ByDoctorResponse = {
  rows: [
    {
      kind: "doctor",
      providerId: DOCTOR_A,
      name: "Doctor A",
      lineCount: 1,
      quantity: 1,
      amountMinor: "7000",
      currency: "KWD",
    },
    {
      kind: "tax",
      providerId: null,
      name: "x",
      lineCount: 0,
      quantity: 0,
      amountMinor: "500",
      currency: "KWD",
    },
    {
      kind: "none",
      providerId: null,
      name: "x",
      lineCount: 2,
      quantity: 3,
      amountMinor: "3000",
      currency: "KWD",
    },
  ],
  totals: { lineCount: 3, quantity: 4, billedMinor: "10000", taxMinor: "500", totalMinor: "10500" },
  currency: "KWD",
  currencyExponent: 3,
};

const money = (m: string) => `${formatReportMinor(m, 3, "ar")} KWD`;
const names = () =>
  within(screen.getByTestId("report-table"))
    .getAllByTestId("report-row")
    .map((r) => r.querySelector("[data-kind]")?.getAttribute("data-kind"));
const summary = (key: string) =>
  screen.getByTestId("revenue-summary").querySelector(`[data-total="${key}"]`)?.textContent ?? "";

async function open(report: ReportId, keys = ANALYTICS) {
  context.reportId = report;
  const api = await signIn(personaWith(keys));
  renderScreen(<ReportScreenPage />);
  return api;
}

it.each([
  ["by_service", serviceData, "byService"],
  ["by_doctor", doctorData, "byDoctor"],
] as const)(
  "%s totals equal the BigInt row sums and the tax row is shown last",
  async (report, data, method) => {
    const api = await signIn(personaWith(ANALYTICS));
    vi.spyOn(api.reports, method).mockResolvedValue(data as never);
    context.reportId = report;
    renderScreen(<ReportScreenPage />);
    await screen.findAllByTestId("report-row");
    const billed = sumMinor(data.rows.filter((r) => r.kind !== "tax").map((r) => r.amountMinor));
    const tax = sumMinor(data.rows.filter((r) => r.kind === "tax").map((r) => r.amountMinor));
    expect(billed).toBe(data.totals.billedMinor);
    expect(tax).toBe(data.totals.taxMinor);
    expect(sumMinor([billed, tax])).toBe(data.totals.totalMinor);
    expect(data.rows.reduce((n, r) => n + r.lineCount, 0)).toBe(data.totals.lineCount);
    expect(summary("billed")).toContain(money(billed));
    expect(summary("tax")).toContain(money(tax));
    expect(summary("total")).toContain(money(data.totals.totalMinor));
    expect(names().at(-1)).toBe("tax");
    expect(screen.getAllByText(F.revenue.taxRow).length).toBeGreaterThan(0);
    const special = report === "by_service" ? F.revenue.freeRow : F.revenue.noDoctorRow;
    expect(screen.getAllByText(special).length).toBeGreaterThan(0);
    expect(
      screen.getByText(report === "by_service" ? F.byServiceNote : F.byDoctorNote),
    ).toBeTruthy();
  },
);

it("taxLast moves the tax row to the end and keeps the others in order", () => {
  expect(taxLast(serviceData.rows).map((r) => r.kind)).toEqual(["service", "free", "tax"]);
  expect(taxLast(doctorData.rows).map((r) => r.kind)).toEqual(["doctor", "none", "tax"]);
});

it("report_analytics with view:invoices opens R3/R4; without it or with report_own only, never", () => {
  for (const report of ["by_service", "by_doctor"] as const) {
    expect(canOpenReport(ANALYTICS, report)).toBe(true);
    expect(canOpenReport(["view:report_analytics:branch", "view:invoices:branch"], report)).toBe(
      true,
    );
    expect(canOpenReport(["view:report_analytics:clinic"], report)).toBe(false);
    expect(canOpenReport(["view:report_own:own", "view:invoices:clinic"], report)).toBe(false);
  }
  expect(availableScreens(ANALYTICS)).toEqual(["by_service", "by_doctor"]);
  expect(availableScreens(["view:report_analytics:clinic"])).toEqual([]);
});

it.each(["by_service", "by_doctor"] as const)(
  "the %s route opens for an allowed caller with real data",
  async (report) => {
    await issue([freeLine("10000")]);
    await open(report);
    expect(await screen.findByRole("heading", { name: F.names[report] })).toBeTruthy();
    await screen.findAllByTestId("report-row");
    expect(summary("billed")).not.toBe("");
  },
);

it.each(["by_service", "by_doctor"] as const)(
  "the %s route is forbidden without view:invoices",
  async (report) => {
    await open(report, ["view:report_analytics:clinic"]);
    expect(screen.getByText(ar.forbidden.title)).toBeTruthy();
  },
);

it("an empty period shows the empty state, and an error offers a retry", async () => {
  await open("by_service");
  expect(await screen.findByText(F.states.empty)).toBeTruthy();
  document.body.innerHTML = "";
  const api = await signIn(personaWith(ANALYTICS));
  const spy = vi
    .spyOn(api.reports, "byDoctor")
    .mockRejectedValueOnce(new ApiError("unknown"))
    .mockResolvedValue(doctorData);
  context.reportId = "by_doctor";
  renderScreen(<ReportScreenPage />);
  (await screen.findByRole("button", { name: F.states.retry })).click();
  await screen.findAllByTestId("report-row");
  expect(spy).toHaveBeenCalledTimes(2);
});
