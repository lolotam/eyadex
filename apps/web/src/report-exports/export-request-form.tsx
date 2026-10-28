import { useId, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";
import type { ReportId } from "@eyadex/contracts/finance-reports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TranslationKey } from "@/shared/i18n/dictionary";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { ExportSelectField } from "./export-select-field";
import { useExportForm, type ExportFormOutcome } from "./use-export-form";

// UI-only picker values; the hook keeps `null` for "all", so neither ever reaches the request.
const ALL = "__all__";
const UNAVAILABLE = "__unavailable__";
const ISSUE_KEYS = ["required", "date", "dateOrder", "rangeTooLong"] as const;

/** The export request form. `useExportForm` owns the draft, access, validation and submission. */
export function ExportRequestForm() {
  const { t, tDynamic, pick } = useI18n();
  const { session } = useSession();
  const form = useExportForm();
  const uid = useId();
  const [last, setLast] = useState<ExportFormOutcome["status"] | null>(null);
  const { draft, branches } = form;
  const ids = (name: string) => `${uid}-${name}`;
  const reportName = (r: ReportId) => t(`reportExports.reports.${r}` as TranslationKey);

  const issueText = (message: string | null) => {
    const key = message?.slice("validation.".length);
    return key && (ISSUE_KEYS as readonly string[]).includes(key)
      ? t(`reportExports.request.issues.${key}` as TranslationKey)
      : t("errors.validation");
  };
  const issuesAt = (path: string) => form.issues.filter((i) => i.path === path);
  const pathText = (path: string) => {
    const found = issuesAt(path);
    return found.length ? [...new Set(found.map((i) => issueText(i.message)))].join(" ") : null;
  };
  const fieldText = (field: "report" | "branchId") => {
    const issue = form.fieldIssues.find((i) => i.field === field);
    if (!issue) return null;
    if (issue.field === "report")
      return t(
        issue.code === "required"
          ? "reportExports.request.fields.reportRequired"
          : "reportExports.request.fields.reportUnavailable",
      );
    return t(
      issue.code === "not_ready"
        ? "reportExports.request.fields.branchNotReady"
        : "reportExports.request.fields.branchUnavailable",
    );
  };
  const known = new Set(["report", "from", "to", "branchId", "groupBy", "format", "language"]);
  const general = form.issues.filter((i) => !known.has(i.path));
  const apiError = (() => {
    if (!form.error) return null;
    const text = tDynamic(`errors.${form.error}`);
    return text === `errors.${form.error}` ? t("errors.unknown") : text;
  })();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const outcome = await form.submit();
    setLast(outcome.status);
  };

  const reportLost = draft.report !== null && !form.reportEligible;
  // Live state wins over the last submit's field issues, so a fixed field never shows an old error.
  const reportError = reportLost
    ? t("reportExports.request.fields.reportUnavailable")
    : draft.report === null
      ? fieldText("report")
      : pathText("report");
  const branchError = form.branchUnavailable
    ? t("reportExports.request.fields.branchUnavailable")
    : !branches.isReady
      ? fieldText("branchId")
      : pathText("branchId");
  const branchValue = !branches.isReady
    ? ""
    : form.branchUnavailable
      ? UNAVAILABLE
      : (draft.branchId ?? ALL);
  const reportOptions = form.eligibleReports.map((r) => ({ value: r, label: reportName(r) }));
  if (reportLost && draft.report)
    reportOptions.unshift({ value: draft.report, label: reportName(draft.report) });
  const disabled = form.isPending;
  const zone = session?.clinic?.timezone ?? "";

  return (
    <section aria-labelledby={ids("title")} className="flex flex-col gap-3">
      <header>
        <h2 id={ids("title")} className="text-base font-semibold">
          {t("reportExports.request.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("reportExports.request.subtitle")}</p>
      </header>
      <form
        noValidate
        onSubmit={(e) => void onSubmit(e)}
        aria-busy={form.isPending || undefined}
        className="flex flex-col gap-4 rounded-md border bg-card p-4"
      >
        {form.eligibleReports.length === 0 && !reportLost ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="size-4 shrink-0" aria-hidden />
            {t("reportExports.request.noReports")}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <ExportSelectField
            id={ids("report")}
            label={t("reportExports.request.report")}
            placeholder={t("reportExports.request.reportPlaceholder")}
            value={draft.report ?? ""}
            options={reportOptions.map((o) => ({
              ...o,
              disabled: reportLost && o.value === draft.report,
            }))}
            onChange={(v) => form.setReport(v as ReportId)}
            disabled={disabled}
            error={reportError}
          />
          {(["from", "to"] as const).map((name) => {
            const error = pathText(name);
            return (
              <div key={name} className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={ids(name)}>{t(`reportExports.request.${name}`)}</Label>
                <Input
                  id={ids(name)}
                  type="date"
                  required
                  className="min-h-11 bg-card md:min-h-9"
                  value={draft[name]}
                  disabled={disabled}
                  onChange={(e) =>
                    name === "from" ? form.setFrom(e.target.value) : form.setTo(e.target.value)
                  }
                  aria-invalid={error ? true : undefined}
                  aria-describedby={[ids("dates-help"), error ? ids(`${name}-error`) : null]
                    .filter(Boolean)
                    .join(" ")}
                />
                {error ? (
                  <p id={ids(`${name}-error`)} className="text-xs text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
          <ExportSelectField
            id={ids("branch")}
            label={t("reportExports.request.branch")}
            placeholder={
              branches.isLoading ? t("reportExports.request.branchesLoading") : undefined
            }
            value={branchValue}
            options={
              branches.isReady
                ? [
                    ...(form.branchUnavailable
                      ? [
                          {
                            value: UNAVAILABLE,
                            label: t("reportExports.request.selectionUnavailable"),
                            disabled: true,
                          },
                        ]
                      : []),
                    { value: ALL, label: t("reportExports.request.allBranches") },
                    ...branches.items.map((b) => ({
                      value: b.id,
                      label: b.isActive
                        ? pick(b.nameAr, b.nameEn)
                        : t("reportExports.request.inactive", { name: pick(b.nameAr, b.nameEn) }),
                    })),
                  ]
                : []
            }
            onChange={(v) => form.setBranchId(v === ALL ? null : v)}
            disabled={disabled || !branches.isReady}
            error={branchError}
          />
        </div>
        <p id={ids("dates-help")} className="-mt-2 text-xs text-muted-foreground">
          {t("reportExports.request.datesHelp", { zone })}
        </p>
        {branches.isLoading && draft.report !== null && form.reportEligible ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("reportExports.request.branchesLoading")}
          </p>
        ) : null}
        {branches.error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm"
          >
            <span className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4 shrink-0" aria-hidden />
              {t("reportExports.request.branchesError")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 md:min-h-9"
              onClick={() => void branches.retry()}
            >
              {t("reportExports.retry")}
            </Button>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {form.groupingApplies ? (
            <ExportSelectField
              id={ids("group")}
              label={t("reportExports.request.groupBy")}
              value={draft.groupBy ?? ""}
              options={form.groupByOptions.map((g) => ({
                value: g,
                label: t(`reportExports.request.groups.${g}`),
              }))}
              onChange={(v) => form.setGroupBy(v as "day" | "month")}
              disabled={disabled}
              error={pathText("groupBy")}
            />
          ) : null}
          <ExportSelectField
            id={ids("format")}
            label={t("reportExports.request.format")}
            value={draft.format}
            options={(["csv", "xlsx"] as const).map((f) => ({
              value: f,
              label: t(`reportExports.formats.${f}`),
            }))}
            onChange={(v) => form.setFormat(v as "csv" | "xlsx")}
            disabled={disabled}
          />
          <ExportSelectField
            id={ids("language")}
            label={t("reportExports.request.language")}
            value={draft.language}
            options={(["ar", "en"] as const).map((l) => ({
              value: l,
              label: t(`reportExports.request.languages.${l}`),
            }))}
            onChange={(v) => form.setLanguage(v as "ar" | "en")}
            disabled={disabled}
          />
        </div>
        {form.isCurrentClinicWideBalance ? (
          <p
            role="note"
            className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm text-foreground"
          >
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            {t("reportExports.request.creditNote")}
          </p>
        ) : null}
        <div aria-live="polite" className="flex flex-col gap-2 text-sm empty:hidden">
          {general.length > 0 ? (
            <p className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4 shrink-0" aria-hidden />
              {t("errors.validation")}
            </p>
          ) : null}
          {apiError ? (
            <p className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4 shrink-0" aria-hidden />
              {apiError}
            </p>
          ) : null}
          {last === "queued" && form.queued ? (
            <p className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />
              {t("reportExports.request.queued")}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end">
          <Button
            type="submit"
            className="min-h-11 w-full gap-1.5 md:min-h-9 md:w-auto"
            disabled={disabled}
          >
            {form.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {form.isPending
              ? t("reportExports.request.submitting")
              : t("reportExports.request.submit")}
          </Button>
        </div>
      </form>
    </section>
  );
}
