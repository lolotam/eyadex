import { useMemo } from "react";
import type {
  reportPatientCreditQuerySchema,
  reportPatientCreditResponseSchema,
} from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { useReportPages, type PageRequest } from "./use-report-pages";

export type PatientCreditQuery = z.output<typeof reportPatientCreditQuerySchema>;
export type PatientCreditPage = z.output<typeof reportPatientCreditResponseSchema>;
export type PatientCreditRow = PatientCreditPage["items"][number];
/** R6 is clinic-wide: the pager is never given a branch, so none can be sent. */
export type PatientCreditFilters = { from: string; to: string };

const request: PageRequest<PatientCreditFilters, PatientCreditPage> = (api, persona, query) =>
  api.reports.patientCredit(persona, query);

/** R6 page by page. Any `branchId` the caller passes is dropped before the key and the request. */
export function usePatientCreditPages(
  filters: (PatientCreditFilters & { branchId?: string | undefined }) | null,
) {
  const from = filters?.from;
  const to = filters?.to;
  const clinicWide = useMemo(
    () => (from !== undefined && to !== undefined ? { from, to } : null),
    [from, to],
  );
  return useReportPages<PatientCreditFilters, PatientCreditRow, PatientCreditPage>(
    "patient_credit",
    request,
    clinicWide,
  );
}
