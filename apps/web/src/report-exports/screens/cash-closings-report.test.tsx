import { screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import {
  api as seedApi,
  admin,
  freeLine,
  issue,
  memberOf,
  pay,
  personaWith,
} from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { context, renderScreen, signIn, TestLink } from "./report-screens.test-kit";
import { availableScreens } from "./report-catalogue";
import { formatReportMinor, sumMinor } from "./report-money";
import { ReportScreenPage } from "./report-screen-page";

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

// Synthetic idempotency keys only: nothing here resembles a real identifier.
const KEY_1 = "00000000-0000-4000-8000-000000000001";
const KEY_2 = "00000000-0000-4000-8000-000000000002";

async function closeDrawer(branchId: string, countedMinor: string, note: string | null, key: string) {
  const preview = await seedApi.cashClosings.preview(admin(), branchId);
  await seedApi.cashClosings.close(
    admin(),
    {
      branchId,
      previousClosingId: preview.previousClosingId,
      throughCashSeq: preview.throughCashSeq,
      countedMinor,
      note,
    },
    key,
  );
}

/** Two closings of one day: a shortage with a note, then an over without one. */
async function story() {
  const a = await issue([freeLine("10000")]);
  await pay(a.id, "3000");
  await closeDrawer(a.branchId, "2500", "عجز", KEY_1);
  const b = await issue([freeLine("10000")]);
  await pay(b.id, "2000");
  await closeDrawer(b.branchId, "2300", null, KEY_2);
}

const open = async (persona = admin()) => {
  const api = await signIn(persona);
  context.reportId = "cash_closings";
  renderScreen(<ReportScreenPage />);
  return api;
};
const totalsCell = (column: string) =>
  screen.getByTestId("report-totals").querySelector(`[data-column="${column}"]`)?.textContent;

it("R9 totals equal the BigInt row sums, a shortage is negative with its word, never method totals", async () => {
  await story();
  const api = await open();
  const rows = await screen.findAllByTestId("report-row");
  expect(rows).toHaveLength(2);
  const r9 = await api.reports.cashClosings(admin(), {
    from: context.session!.clinic ? today() : "",
    to: today(),
  });
  const exp = r9.currencyExponent;
  const money = (m: string) => `${formatReportMinor(m, exp, "ar")} ${r9.currency}`;
  for (const [column, field] of [
    ["expected", "expectedMinor"],
    ["counted", "countedMinor"],
    ["difference", "differenceMinor"],
  ] as const) {
    const sum = sumMinor(r9.rows.map((r) => r[field]));
    expect(sum).toBe(r9.totals[field]);
    expect(totalsCell(column)).toContain(money(sum));
  }
  expect(r9.totals.differenceMinor).toBe("-200");
  expect(totalsCell("difference")).toContain(F.cashClosings.shortage);
  const table = screen.getByTestId("report-table");
  expect(within(table).getAllByText(`(${F.cashClosings.shortage})`).length).toBeGreaterThan(0);
  expect(within(table).getAllByText(`(${F.cashClosings.over})`).length).toBeGreaterThan(0);
  expect(within(table).getAllByText(F.cashClosings.noteYes).length).toBeGreaterThan(0);
  expect(within(table).getAllByText(F.cashClosings.noteNo).length).toBeGreaterThan(0);
  expect(within(table).getAllByText(memberOf("clinic_admin").fullName).length).toBeGreaterThan(0);
  expect(table.textContent).not.toContain(F.columns.method);
});

it("the business day links to the closing page for a caller who may open it", async () => {
  await story();
  await open();
  await screen.findAllByTestId("report-row");
  const links = screen
    .getAllByRole("link")
    .map((a) => a.getAttribute("href"))
    .filter((h) => h?.startsWith("/clinic/cash-closings/"));
  expect(links.length).toBeGreaterThanOrEqual(2);
});

it("receptionist-style keys open R1, R2 and R9; without view:cash_closings or with report_own only, no R9", () => {
  const takings = [
    "view:report_takings:clinic",
    "view:payments:clinic",
    "view:invoices:clinic",
    "view:cash_closings:clinic",
  ];
  expect(availableScreens(takings)).toEqual(["daily_takings", "period_summary", "cash_closings"]);
  expect(availableScreens(takings.filter((k) => k !== "view:cash_closings:clinic"))).not.toContain(
    "cash_closings",
  );
  expect(
    availableScreens(["view:report_own:own", "view:invoices:own", "view:cash_closings:clinic"]),
  ).not.toContain("cash_closings");
});

it("the R9 route opens for an allowed caller and is forbidden without view:cash_closings", async () => {
  await open(as("receptionist"));
  await screen.findByText(F.states.empty);
  expect(screen.getByRole("heading", { name: F.names.cash_closings })).toBeTruthy();
  document.body.innerHTML = "";
  await open(personaWith(["view:report_takings:clinic", "view:payments:clinic"]));
  expect(screen.getByText(ar.forbidden.title)).toBeTruthy();
});

function today() {
  const zone = context.session?.clinic?.timezone ?? "Asia/Kuwait";
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
}
