import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { invoiceSettlement, type PatientMoney } from "@eyadex/contracts/settlement";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoiceSettlementChip } from "./invoice-settlement-chip";
import { releasesOnEdit, releasesOnVoid } from "./invoice-release-warning";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const money = (paid: bigint): PatientMoney => ({
  payments: [{ id: "p", invoiceId: "i", amountMinor: paid }],
  allocations:
    paid > 0n
      ? [
          {
            id: "a",
            invoiceId: "i",
            paymentId: "p",
            creditId: null,
            amountMinor: paid,
            createdAt: "2026-10-20T08:00:00.000Z",
          },
        ]
      : [],
  credits: [],
  refunds: [],
  refundSources: [],
});

const stateFor = (paid: bigint) =>
  invoiceSettlement(money(paid), { id: "i", status: "issued", totalMinor: 5000n })!.state;

describe("the settlement chip", () => {
  for (const [lang, dict] of [
    ["ar", ar],
    ["en", en],
  ] as const) {
    it(`labels the shared function's state in ${lang}`, () => {
      localStorage.setItem("eyadex:language", lang);
      for (const [paid, label] of [
        [0n, dict.payments.state.unpaid],
        [1000n, dict.payments.state.partly_paid],
        [5000n, dict.payments.state.paid],
      ] as const) {
        render(
          <I18nProvider>
            <InvoiceSettlementChip
              settlement={{ state: stateFor(paid), paidMinor: "0", owedMinor: "0" }}
            />
          </I18nProvider>,
        );
        expect(screen.getByText(label)).toBeInTheDocument();
        cleanup();
      }
    });
  }

  it("shows nothing on a void invoice", () => {
    const { container } = render(
      <I18nProvider>
        <InvoiceSettlementChip settlement={null} />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the patient-credit warning", () => {
  const paid = (minor: string) => ({
    settlement: { state: "partly_paid" as const, paidMinor: minor, owedMinor: "1" },
  });
  it("shows on a void only when something is paid", () => {
    expect(releasesOnVoid(paid("1000"))).toBe(true);
    expect(releasesOnVoid({ settlement: null })).toBe(false);
  });
  it("shows on an edit only when the new total is below what is paid", () => {
    expect(releasesOnEdit(paid("1000"), 999n)).toBe(true);
    expect(releasesOnEdit(paid("1000"), 1000n)).toBe(false);
  });
});
