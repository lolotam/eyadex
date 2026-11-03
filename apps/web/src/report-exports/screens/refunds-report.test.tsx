import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { context, renderScreen, signIn, TestLink } from "./report-screens.test-kit";
import { formatReportMinor, sumMinor } from "./report-money";
import { ReportScreenPage } from "./report-screen-page";
import { deferred } from "./outstanding-report.fixtures";
import {
  ADJ_PATIENT_ID,
  pageOf,
  R7_KEYS,
  REFUND_ID,
  refundRow,
} from "./adjustment-reports.fixtures";
import type { RefundsPage } from "./use-refunds-pages";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: context.persona, ready: true }),
  useSession: () => ({ session: context.session, isLoading: false, error: null }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: TestLink,
  useParams: () => ({ reportId: context.reportId }),
}));

const O = ar.financeReports.outstanding;
const A = ar.financeReports.adjustments;
beforeEach(() => {
  resetMockData();
  context.reportId = "refunds";
});

const ALL = [
  refundRow(1, "9007199254740993"),
  refundRow(2, "9007199254740995", { source: "credit", refundedByName: null, method: "knet" }),
  refundRow(3, "1500", { reason: "<b>x</b>\nline two" }),
];

type Pages = RefundsPage[] | ((q: { cursor?: string | undefined }) => Promise<RefundsPage>);
async function open(pages: Pages) {
  const api = await signIn(personaWith(R7_KEYS));
  const spy = vi.spyOn(api.reports, "refunds");
  if (typeof pages === "function") spy.mockImplementation((_p, q) => pages(q));
  else for (const p of pages) spy.mockResolvedValueOnce(p);
  renderScreen(<ReportScreenPage />);
  return spy;
}
const rows = () => within(screen.getByTestId("report-table")).queryAllByTestId("report-row");

it("the route opens with the real mock and shows the period empty state", async () => {
  await signIn(personaWith(R7_KEYS));
  renderScreen(<ReportScreenPage />);
  expect(
    await screen.findByRole("heading", { name: ar.financeReports.names.refunds }),
  ).toBeTruthy();
  expect(await screen.findByText(ar.financeReports.states.empty)).toBeTruthy();
});

it("labels the source and method, and shows «—» for a refunder who is gone", async () => {
  await open([pageOf(ALL, 3, null)]);
  await waitFor(() => expect(rows()).toHaveLength(3));
  const second = rows()[1]!;
  expect(within(second).getAllByText(A.source.credit).length).toBeGreaterThan(0);
  expect(within(second).getAllByText(ar.payments.method.knet).length).toBeGreaterThan(0);
  expect(within(second).getAllByText(A.noValue).length).toBeGreaterThan(0);
  expect(within(rows()[0]!).getAllByText(A.source.payment).length).toBeGreaterThan(0);
  expect(en.financeReports.adjustments.source).toEqual({
    payment: "From receipt",
    credit: "From credit",
  });
});

it("the reason is plain text, collapsed in the row and expandable", async () => {
  await open([pageOf(ALL, 3, null)]);
  await waitFor(() => expect(rows()).toHaveLength(3));
  const cell = rows()[2]!;
  expect(cell.querySelector("b")).toBeNull();
  const text = within(cell).getAllByTestId("reason-text")[0]!;
  expect(text.textContent).toBe("<b>x</b> line two");
  const toggle = within(cell).getAllByRole("button", { name: A.more })[0]!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(text.textContent).toBe("<b>x</b>\nline two");
});

it("load more appends exactly the next page and shows the total", async () => {
  const spy = await open([pageOf(ALL.slice(0, 2), 3, "c2"), pageOf(ALL.slice(2), 3, null)]);
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(spy.mock.calls[0]?.[1]).toMatchObject({ limit: 50 });
  expect(spy.mock.calls[0]?.[1]).not.toHaveProperty("cursor");
  expect(screen.getByTestId("refunds-showing").textContent).toContain("٣");
  fireEvent.click(screen.getByRole("button", { name: O.loadMore }));
  await waitFor(() => expect(rows()).toHaveLength(3));
  expect(spy.mock.calls[1]?.[1]).toMatchObject({ cursor: "c2" });
});

it("a filter change restarts at page 1 and a late page of the old filter is ignored", async () => {
  const late = deferred<RefundsPage>();
  let call = 0;
  await open(async () => {
    call += 1;
    if (call === 1) return pageOf([ALL[0]!], 3, "c2");
    if (call === 2) return late.promise;
    return pageOf([ALL[2]!], 1, null);
  });
  await waitFor(() => expect(rows()).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: O.loadMore }));
  fireEvent.change(screen.getByLabelText(ar.financeReports.filters.from), {
    target: { value: "2026-10-02" },
  });
  await waitFor(() => expect(screen.getAllByText("Adjust Person 3").length).toBeGreaterThan(0));
  await act(async () => late.resolve(pageOf([ALL[1]!], 3, null)));
  expect(rows()).toHaveLength(1);
  expect(screen.queryByText("Adjust Person 2")).toBeNull();
});

it("an error on load more keeps earlier pages and retries only that page", async () => {
  const spy = await open([pageOf([ALL[0]!], 3, "c2")]);
  spy
    .mockRejectedValueOnce(new ApiError("unknown"))
    .mockResolvedValueOnce(pageOf([ALL[1]!], 3, null));
  await waitFor(() => expect(rows()).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: O.loadMore }));
  fireEvent.click(await screen.findByRole("button", { name: O.retryMore }));
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(spy.mock.calls.slice(1).map((c) => c[1].cursor)).toEqual(["c2", "c2"]);
});

it("the totals row appears only when every page is loaded and equals the BigInt sum", async () => {
  await open([pageOf(ALL.slice(0, 2), 3, "c2"), pageOf(ALL.slice(2), 3, null)]);
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(screen.queryByTestId("report-totals")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: O.loadMore }));
  await waitFor(() => expect(rows()).toHaveLength(3));
  const sum = sumMinor(ALL.map((r) => r.amountMinor));
  expect(sum).toBe("18014398509483488");
  const cell = screen.getByTestId("report-totals").querySelector('[data-column="amount"]');
  expect(cell?.textContent).toBe(`${formatReportMinor(sum, 3, "ar")} KWD`);
});

it("no patient or refund id reaches the DOM", async () => {
  await open([pageOf(ALL, 3, null)]);
  await waitFor(() => expect(rows()).toHaveLength(3));
  const html = document.body.innerHTML;
  for (let n = 1; n <= 3; n += 1) {
    expect(html).not.toContain(ADJ_PATIENT_ID(n));
    expect(html).not.toContain(REFUND_ID(n));
  }
});

it("shows the branch picker and the first-page error with a retry", async () => {
  const spy = await open([]);
  spy.mockRejectedValueOnce(new ApiError("unknown")).mockResolvedValueOnce(pageOf([], 0, null));
  expect(screen.getByLabelText(ar.financeReports.filters.branch)).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: ar.financeReports.states.retry }));
  expect(await screen.findByText(ar.financeReports.states.empty)).toBeTruthy();
});
