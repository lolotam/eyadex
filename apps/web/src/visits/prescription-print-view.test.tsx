import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PrescriptionPrint } from "@eyadex/contracts/visits";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PrescriptionPrintView } from "./prescription-print-view";

afterEach(() => cleanup());

const base: PrescriptionPrint = {
  clinic: { nameAr: "عيادة تجريبية", nameEn: "Demo Clinic" },
  branch: { nameAr: "الفرع", nameEn: "Branch" },
  patient: { fullName: "Test Person", fileNumber: 42 },
  providerName: "Dr Test",
  startedAt: "2026-03-01T06:00:00.000Z",
  signedAt: "2026-03-05T06:00:00.000Z",
  items: [
    {
      position: 0,
      medicine: "Testamine 5 mg",
      dose: "1",
      frequency: "daily",
      duration: "1 week",
      note: "after food",
    },
  ],
};

const day = (iso: string) =>
  new Intl.DateTimeFormat("ar-KW", { dateStyle: "long", timeZone: "Asia/Kuwait" }).format(
    new Date(iso),
  );

describe("the prescription print view", () => {
  it("renders both clinic names, the patient, the items and the signing date", () => {
    render(
      <I18nProvider>
        <PrescriptionPrintView data={base} timeZone="Asia/Kuwait" />
      </I18nProvider>,
    );
    expect(screen.getByText("عيادة تجريبية")).toBeInTheDocument();
    expect(screen.getByText("Demo Clinic")).toBeInTheDocument();
    expect(screen.getByText("Testamine 5 mg")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(day(base.signedAt!))).toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveAttribute("dir", "rtl");
  });

  it("uses the start date while the visit is not signed", () => {
    render(
      <I18nProvider>
        <PrescriptionPrintView
          data={{ ...base, signedAt: null, items: [] }}
          timeZone="Asia/Kuwait"
        />
      </I18nProvider>,
    );
    expect(screen.getByText(day(base.startedAt))).toBeInTheDocument();
    expect(screen.getByText(ar.printView.empty)).toBeInTheDocument();
  });
});
