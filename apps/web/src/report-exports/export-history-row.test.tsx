import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  REPORT_IDS,
  reportExportSchema,
  type ReportExport,
} from "@eyadex/contracts/finance-reports";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ExportHistoryRow } from "./export-history-row";

// Pure presentation fixtures: strict contract-valid metadata only, never a successful business job.
vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({ session: { clinic: { timezone: "Asia/Kuwait" } } }),
}));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
const base = reportExportSchema.parse({
  id: "0190a000-0000-7000-8000-000000000001",
  report: "daily_takings",
  format: "csv",
  status: "done",
  rowCount: 7,
  byteSize: 987654,
  createdAt: "2026-03-01T21:30:00.000Z",
  expiresAt: "2026-03-02T21:30:00.000Z",
});
function show(row: ReportExport, lang: "ar" | "en" = "en", extra: Partial<Parameters<typeof ExportHistoryRow>[0]> = {}) {
  window.localStorage.setItem("eyadex:language", lang);
  const onDownload = vi.fn();
  render(
    <I18nProvider>
      <ul>
        <ExportHistoryRow
          row={row}
          canDownload={row.status === "done"}
          pending={false}
          unavailable={false}
          error={null}
          onDownload={onDownload}
          {...extra}
        />
      </ul>
    </I18nProvider>,
  );
  return { onDownload, item: screen.getByTestId("export-row") };
}

it.each(["ar", "en"] as const)("names all ten reports in %s", (lang) => {
  const dict = lang === "ar" ? ar : en;
  for (const report of REPORT_IDS) {
    const { item } = show({ ...base, report }, lang);
    expect(item).toHaveTextContent(dict.reportExports.reports[report]);
    expect(item.textContent).not.toMatch(/reportExports\./);
    cleanup();
  }
});

it.each(["queued", "running", "done", "failed", "expired", "purged"] as const)(
  "shows the %s label and a download only when the hook allows it",
  (status) => {
    const { item } = show({ ...base, status });
    expect(item).toHaveTextContent(en.reportExports.statuses[status]);
    expect(within(item).queryAllByRole("button")).toHaveLength(status === "done" ? 1 : 0);
  },
);

it("formats clinic-time dates, omits byte size and null fields", () => {
  const { item } = show({ ...base, expiresAt: null, rowCount: null });
  const times = item.querySelectorAll("time");
  expect(times).toHaveLength(1);
  expect(times[0]?.getAttribute("dateTime")).toBe(base.createdAt);
  // 21:30 UTC is 00:30 next day in Kuwait.
  expect(times[0]?.textContent).toContain("2 Mar 2026");
  expect(item).not.toHaveTextContent("987654");
  expect(item).not.toHaveTextContent(en.reportExports.rows);
  expect(item).not.toHaveTextContent(base.id);
});

it("labels the action with report and format and hands the row to the hook", () => {
  const { onDownload } = show({ ...base, format: "xlsx" }, "ar");
  const button = screen.getByRole("button", { name: "تنزيل الإيراد اليومي (Excel (XLSX))" });
  button.focus();
  expect(button).toHaveFocus();
  fireEvent.click(button);
  expect(onDownload).toHaveBeenCalledWith({ ...base, format: "xlsx" });
});

it("disables while pending and hides an unavailable done row", () => {
  show(base, "en", { pending: true });
  expect(screen.getByRole("button")).toBeDisabled();
  expect(screen.getByRole("button")).toHaveTextContent(en.reportExports.downloading);
  cleanup();
  show(base, "en", { unavailable: true, error: "forbidden" });
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent(en.reportExports.unavailable);
  cleanup();
  show(base, "en", { canDownload: false });
  expect(screen.queryByRole("button")).toBeNull();
});
