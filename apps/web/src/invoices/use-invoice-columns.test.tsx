import { cleanup, render, screen } from "@testing-library/react";
import { getCoreRowModel, useReactTable, flexRender } from "@tanstack/react-table";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvoiceListItem } from "@/shared/api/finance-client";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { useInvoiceColumns } from "./use-invoice-columns";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#invoice">{children}</a>,
}));

const item: InvoiceListItem = {
  id: "00000000-0000-7000-8000-000000000001",
  number: "SLMR-2026-000001",
  status: "issued",
  source: "manual",
  sourceId: null,
  branchId: "00000000-0000-7000-8000-000000000002",
  branchNameAr: "فرع الروضة",
  branchNameEn: "Rawda branch",
  patientId: "00000000-0000-7000-8000-000000000003",
  patientName: "مراجع تجريبي طويل الاسم جدا",
  issuedAt: "2026-10-15T09:00:00.000Z",
  currency: "KWD",
  currencyExponent: 3,
  subtotalMinor: "1000",
  discountMinor: "0",
  taxRateBp: 0,
  taxMinor: "0",
  totalMinor: "1000",
  invoiceDiscount: null,
  voidReason: null,
  voidedAt: null,
  version: 1,
};

function Table() {
  const columns = useInvoiceColumns((minor) => minor);
  const table = useReactTable({ data: [item], columns, getCoreRowModel: getCoreRowModel() });
  return (
    <table>
      <thead>
        <tr>
          {table.getFlatHeaders().map((h) => (
            <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

// PR #78 review: the branch name comes with the invoice (a doctor's own invoices cross branches outside
// its membership), and the column that shows the source is titled as the source, not the patient.
describe("the invoice list columns", () => {
  it.each([
    ["ar", "المراجع"],
    ["en", "Patient"],
  ])("shows the patient name right after the number (%s)", (lang, header) => {
    window.localStorage.setItem("eyadex:language", lang);
    render(
      <I18nProvider manageDocument={false}>
        <Table />
      </I18nProvider>,
    );
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers[1]).toBe(header);
    const cell = screen.getByRole("cell", { name: item.patientName });
    expect(cell.querySelector("[title]")?.getAttribute("title")).toBe(item.patientName);
    expect(cell.querySelector("a")).toBeNull();
  });

  it("names the invoice's own branch and titles the source column as the source", () => {
    render(
      <I18nProvider manageDocument={false}>
        <Table />
      </I18nProvider>,
    );
    expect(screen.getByRole("cell", { name: "فرع الروضة" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "المصدر" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "المراجع" })).toBeTruthy();
  });
});
