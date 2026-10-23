import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { instantToWall } from "@eyadex/contracts/clinic-time";
import { formatMinor, formatSignedMinor } from "@eyadex/contracts/money";
import { Button } from "@/components/ui/button";
import { branchNameIn, useReceiptBranches } from "@/payments/receipt-queries";
import { ReceiptRow as Row } from "@/payments/receipt-row";
import { errorKeyOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { ClosingDifference } from "./closing-difference";
import { ClosingMethodTotals } from "./closing-method-totals";
import { ClosingMovements } from "./closing-movements";
import { useClosing } from "./closing-queries";

/** A saved closing, read-only: it is never edited or reopened (F2-Q11). No patient appears on it. */
export function ClosingDetails({ closingId }: { closingId: string }) {
  const { t, tDynamic, pick, formatDate } = useI18n();
  const { session } = useSession();
  const closing = useClosing(closingId);
  const branches = useReceiptBranches(can(session?.permissions ?? [], "view", "payments"));
  const back = (
    <Button asChild variant="outline">
      <Link to="/clinic/cash-closings">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("cashClosings.detail.back")}
      </Link>
    </Button>
  );
  if (closing.isError)
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("cashClosings.detail.loadError")}
        body={tDynamic(`errors.${errorKeyOf(closing.error)}`)}
        action={<Button onClick={() => void closing.refetch()}>{t("common.tryAgain")}</Button>}
      />
    );
  if (!closing.data) return <LoadingBlock />;
  const k = closing.data;
  const zone = session?.clinic?.timezone ?? "UTC";
  const exp = k.currencyExponent;
  return (
    <div className="max-w-2xl">
      <PageHeader
        title={t("cashClosings.detail.title", { date: formatDate(k.businessDate) })}
        actions={back}
      />
      <dl className="mb-4 rounded-lg border bg-card px-4">
        <Row label={t("cashClosings.branch")}>
          {branches.isError ? (
            <span className="flex flex-wrap items-center gap-2 text-destructive">
              {t("cashClosings.branchesError")}
              <Button size="sm" variant="outline" onClick={() => void branches.refetch()}>
                {t("common.tryAgain")}
              </Button>
            </span>
          ) : (
            branchNameIn(branches.data, k.branchId, pick)
          )}
        </Row>
        <Row label={t("cashClosings.detail.closedAt")}>
          <span dir="ltr">{instantToWall(k.closedAt, zone).time}</span>
        </Row>
        <Row label={t("cashClosings.detail.period")}>
          <span dir="ltr">{`${BigInt(k.fromCashSeq) + 1n} – ${k.toCashSeq}`}</span>
        </Row>
        <Row label={t("cashClosings.expected")}>
          <span dir="ltr">{`${formatSignedMinor(k.expectedMinor, exp)} ${k.currency}`}</span>
        </Row>
        <Row label={t("cashClosings.counted")}>
          <span dir="ltr">{`${formatMinor(k.countedMinor, exp)} ${k.currency}`}</span>
        </Row>
        <Row label={t("cashClosings.difference")}>
          <ClosingDifference
            differenceMinor={k.differenceMinor}
            exponent={exp}
            currency={k.currency}
          />
        </Row>
        <Row label={t("cashClosings.note")}>{k.note ?? "—"}</Row>
        <Row label={t("cashClosings.detail.previous")}>
          {k.previousClosingId ? (
            <Link
              to="/clinic/cash-closings/$closingId"
              params={{ closingId: k.previousClosingId }}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("cashClosings.open")}
            </Link>
          ) : (
            t("cashClosings.detail.none")
          )}
        </Row>
      </dl>
      <div className="grid gap-4">
        <ClosingMovements movements={k.movements} exponent={exp} currency={k.currency} />
        <ClosingMethodTotals totals={k.methodTotals} exponent={exp} currency={k.currency} />
      </div>
    </div>
  );
}
