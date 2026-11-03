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
  discountRow,
  INVOICE_ID,
  pageOf,
  R8_KEYS,
} from "./adjustment-reports.fixtures";
import type { DiscountsPage } from "./use-discounts-pages";

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
  context.reportId = "discounts";
});

const ALL = [
  discountRow(1, "9007199254740993"),
  discountRow(2, "9007199254740995", {
    kind: "invoice",
    discountedBy: null,
    discountedByName: null,
  }),
  discountRow(3, "1500", { reason: "" }),
];

type Pages = DiscountsPage[] | ((q: { cursor?: string | undefined }) => Promise<DiscountsPage>);
async function open(pages: Pages, keys = R8_KEYS) {
  const api = await signIn(personaWith(keys));
  const spy = vi.spyOn(api.reports, "discounts");
  if (typeof pages === "function") spy.mockImplementation((_p, q) => pages(q));
  else for (const p of pages) spy.mockResolvedValueOnce(p);
  renderScreen(<ReportScreenPage />);
  return spy;
}
const rows = () => within(screen.getByTestId("report-table")).queryAllByTestId("report-row");

it("the route opens with the real mock data", async () => {
  await signIn(personaWith(R8_KEYS));
  renderScreen(<ReportScreenPage />);
  expect(
    await screen.findByRole("heading", { name: ar.financeReports.names.discounts }),
  ).toBeTruthy();
});

it("labels the kind, shows «—» for an unknown author and for an empty reason", async () => {
  await open([pageOf(ALL, 3, null)]);
  await waitFor(() => expect(rows()).toHaveLength(3));
  expect(within(rows()[0]!).getAllByText(A.kind.line).length).toBeGreaterThan(0);
  expect(within(rows()[1]!).getAllByText(A.kind.invoice).length).toBeGreaterThan(0);
  expect(within(rows()[1]!).getAllByText(A.noValue).length).toBeGreaterThan(0);
  expect(within(rows()[2]!).getAllByText(A.noValue).length).toBeGreaterThan(0);
  expect(en.financeReports.adjustments.kind).toEqual({ line: "Line", invoice: "Invoice" });
});

it("links the invoice number only with view:invoices, and the href holds only the invoice id", async () => {
  await open([pageOf([ALL[0]!], 1, null)]);
  const link = await screen.findAllByRole("link", { name: "T-1" });
  expect(link[0]!.getAttribute("href")).toBe(`/clinic/invoices/${INVOICE_ID(1)}`);
  const html = document.body.innerHTML;
  for (let n = 1; n <= 3; n += 1) expect(html).not.toContain(ADJ_PATIENT_ID(n));
});

it("load more appends the next page; the total shows only when complete, as the BigInt sum", async () => {
  const spy = await open([pageOf(ALL.slice(0, 2), 3, "c2"), pageOf(ALL.slice(2), 3, null)]);
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(screen.queryByTestId("report-totals")).toBeNull();
  expect(screen.getByTestId("discounts-showing").textContent).toContain("٣");
  fireEvent.click(screen.getByRole("button", { name: O.loadMore }));
  await waitFor(() => expect(rows()).toHaveLength(3));
  expect(spy.mock.calls[1]?.[1]).toMatchObject({ limit: 50, cursor: "c2" });
  const sum = sumMinor(ALL.map((r) => r.discountMinor));
  const cell = screen.getByTestId("report-totals").querySelector('[data-column="discount"]');
  expect(cell?.textContent).toBe(`${formatReportMinor(sum, 3, "ar")} KWD`);
});

it("a late page of the old filter is ignored after a filter change", async () => {
  const late = deferred<DiscountsPage>();
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

it("sends branchId when a branch is chosen", async () => {
  const api = await signIn(personaWith(R8_KEYS));
  const spy = vi.spyOn(api.reports, "discounts");
  const branch = getState().branches.find((b) => b.clinicId === clinicIdAt(0) && b.isActive)!;
  renderScreen(<ReportScreenPage />);
  const select = () => screen.getByLabelText(ar.financeReports.filters.branch) as HTMLSelectElement;
  await waitFor(() => expect(select().disabled).toBe(false));
  fireEvent.change(select(), { target: { value: branch.id } });
  await waitFor(() => expect(spy.mock.calls.at(-1)?.[1]).toMatchObject({ branchId: branch.id }));
});
