import { useI18n } from "@/shared/i18n/i18n-provider";
import type { ReportColumn } from "./report-table";
import type { PatientCreditRow } from "./use-patient-credit-pages";
import type { useReportFormat } from "./use-report-format";

type Format = ReturnType<typeof useReportFormat>;

/** R6 columns. The patient appears by name only, as plain text for everyone: no id, no link. */
export function usePatientCreditColumns(fmt: Format) {
  const { t } = useI18n();
  const columns: ReportColumn<PatientCreditRow>[] = [
    {
      key: "patient",
      label: t("financeReports.patientCredit.columns.patient"),
      cell: (r) => r.patientName,
    },
    {
      key: "balance",
      label: t("financeReports.patientCredit.columns.balance"),
      numeric: true,
      cell: (r) => fmt.money(r.balanceMinor),
    },
    {
      key: "oldestCreditDay",
      label: t("financeReports.patientCredit.columns.oldestCreditDay"),
      cell: (r) => fmt.period(r.oldestCreditDay),
    },
  ];
  return columns;
}
