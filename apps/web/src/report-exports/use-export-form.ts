import { useCallback, useRef, useState } from "react";
import {
  REPORT_IDS,
  type ReportExportFormat,
  type ReportExportRequest,
  type ReportGroupBy,
  type ReportId,
} from "@eyadex/contracts/finance-reports";
import type { Language } from "@eyadex/contracts/common";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { useExportBranchOptions } from "./use-export-branch-options";
import { useRequestExport, type RequestExportOutcome } from "./use-request-export";

/** Spec §4: only R1 and R2 group their range, each with its own default. */
const GROUP_DEFAULT: Partial<Record<ReportId, ReportGroupBy>> = {
  daily_takings: "day",
  period_summary: "month",
};
const GROUP_OPTIONS: readonly ReportGroupBy[] = ["day", "month"];

export type ExportFormDraft = {
  report: ReportId | null;
  from: string;
  to: string;
  /** null is "all branches in reach": the body then omits `branchId`. */
  branchId: string | null;
  groupBy: ReportGroupBy | null;
  format: ReportExportFormat;
  /** null follows the UI language until the user picks one explicitly. */
  language: Language | null;
};
/** Field codes for the later form to translate; never display text. */
export type ExportFormFieldIssue =
  | { field: "report"; code: "required" | "unavailable" }
  | { field: "branchId"; code: "not_ready" | "unavailable" };
export type ExportFormOutcome =
  RequestExportOutcome | { status: "blocked"; issues: ExportFormFieldIssue[] };

const INITIAL: ExportFormDraft = {
  report: null,
  from: "",
  to: "",
  branchId: null,
  groupBy: null,
  format: "csv",
  language: null,
};

/**
 * The export form's draft and submit. The draft belongs to one actor epoch: any identity change,
 * A→B→A included, starts a fresh draft, and setters or submits from an older epoch do nothing.
 */
export function useExportForm() {
  const { lang } = useI18n();
  const { persona } = usePersona();
  const { session } = useSession();
  const request = useRequestExport();
  const identity = JSON.stringify([
    persona.kind,
    persona.clinicId,
    persona.memberId,
    session?.clinic?.id ?? null,
    session?.membershipId ?? null,
  ]);
  const seen = useRef(identity);
  const generation = useRef(0);
  if (seen.current !== identity) generation.current += 1;
  seen.current = identity;
  const epoch = generation.current;

  const [stored, setStored] = useState<{ epoch: number; draft: ExportFormDraft }>({
    epoch,
    draft: INITIAL,
  });
  const [fieldState, setFieldState] = useState<{ epoch: number; issues: ExportFormFieldIssue[] }>({
    epoch,
    issues: [],
  });
  const draft = stored.epoch === epoch ? stored.draft : INITIAL;
  const fieldIssues = fieldState.epoch === epoch ? fieldState.issues : [];
  const language = draft.language ?? lang;
  const branches = useExportBranchOptions(draft.report);

  const patch = useCallback(
    (change: Partial<ExportFormDraft>) => {
      if (generation.current !== epoch) return;
      setStored((prev) => ({
        epoch,
        draft: { ...(prev.epoch === epoch ? prev.draft : INITIAL), ...change },
      }));
    },
    [epoch],
  );

  const eligibleReports = REPORT_IDS.filter((r) => request.isEligibleFor(r));
  const reportEligible = draft.report !== null && request.isEligibleFor(draft.report);
  const groupingApplies = draft.report !== null && GROUP_DEFAULT[draft.report] !== undefined;
  const branchUnavailable =
    draft.branchId !== null &&
    branches.isReady &&
    !branches.items.some((b) => b.id === draft.branchId);

  const check = (): ExportFormFieldIssue[] => {
    if (draft.report === null) return [{ field: "report", code: "required" }];
    if (!reportEligible) return [{ field: "report", code: "unavailable" }];
    if (!branches.isReady || branches.error !== null)
      return [{ field: "branchId", code: "not_ready" }];
    if (branchUnavailable) return [{ field: "branchId", code: "unavailable" }];
    return [];
  };

  const submit = async (): Promise<ExportFormOutcome> => {
    if (generation.current !== epoch) return { status: "stale" };
    const issues = check();
    setFieldState({ epoch, issues });
    if (issues.length > 0 || draft.report === null) return { status: "blocked", issues };
    const body: ReportExportRequest = {
      report: draft.report,
      from: draft.from,
      to: draft.to,
      ...(draft.branchId !== null ? { branchId: draft.branchId } : {}),
      ...(groupingApplies && draft.groupBy !== null ? { groupBy: draft.groupBy } : {}),
      format: draft.format,
      language,
    };
    return request.submit(body);
  };

  return {
    draft: { ...draft, language },
    eligibleReports,
    reportEligible,
    setReport: (report: ReportId | null) =>
      patch({ report, branchId: null, groupBy: report ? (GROUP_DEFAULT[report] ?? null) : null }),
    setFrom: (from: string) => patch({ from }),
    setTo: (to: string) => patch({ to }),
    setBranchId: (branchId: string | null) => patch({ branchId }),
    setGroupBy: (groupBy: ReportGroupBy) => {
      if (groupingApplies) patch({ groupBy });
    },
    setFormat: (format: ReportExportFormat) => patch({ format }),
    setLanguage: (next: Language) => patch({ language: next }),
    groupingApplies,
    groupByOptions: groupingApplies ? GROUP_OPTIONS : [],
    /** R6 reports the current clinic-wide balance: the dates do not limit it (spec §4, R6). */
    isCurrentClinicWideBalance: draft.report === "patient_credit",
    branches: {
      items: branches.items,
      isReady: branches.isReady,
      isLoading: branches.isLoading,
      error: branches.error,
      retry: branches.retry,
    },
    branchUnavailable,
    fieldIssues,
    canSubmit: check().length === 0 && !request.isPending,
    submit,
    isPending: request.isPending,
    issues: request.issues,
    error: request.error,
    queued: request.queued,
  };
}
