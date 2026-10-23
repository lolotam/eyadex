import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { instantToWall } from "@eyadex/contracts/clinic-time";
import { formatMinor } from "@eyadex/contracts/money";
import { Button } from "@/components/ui/button";
import { errorKeyOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { canAtBranch } from "@/shared/permissions/can-at-branch";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { branchNameIn, useReceiptBranches, useReceipt } from "./receipt-queries";
import { ReceiptRow as Row } from "./receipt-row";

/** The receipt's fields; a failed branch-names read shows its own retry, never a silent «—». */
export function ReceiptDetails({ paymentId }: { paymentId: string }) {
  const { t, tDynamic, pick, formatDate } = useI18n();
  const { session } = useSession();
  const receipt = useReceipt(paymentId);
  const branches = useReceiptBranches();
  const back = (
    <Button asChild variant="outline">
      <Link to="/clinic/payments">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("payments.receipts.back")}
      </Link>
    </Button>
  );
  if (receipt.isError)
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("payments.receipts.loadError")}
        body={tDynamic(`errors.${errorKeyOf(receipt.error)}`)}
        action={<Button onClick={() => void receipt.refetch()}>{t("common.tryAgain")}</Button>}
      />
    );
  if (!receipt.data) return <LoadingBlock />;
  const p = receipt.data;
  const zone = session?.clinic?.timezone ?? "UTC";
  const invoiceLink = session && canAtBranch(session, "view", "invoices", p.branchId);
  return (
    <div className="max-w-2xl">
      <PageHeader
        title={t("payments.receipts.detailTitle", { number: p.receiptNumber })}
        actions={back}
      />
      <dl className="rounded-lg border bg-card px-4">
        <Row label={t("payments.receipts.number")}>
          <span dir="ltr">{p.receiptNumber}</span>
        </Row>
        <Row label={t("payments.receipts.date")}>{formatDate(p.businessDate)}</Row>
        <Row label={t("payments.receipts.time")}>
          <span dir="ltr">{instantToWall(p.receivedAt, zone).time}</span>
        </Row>
        <Row label={t("payments.receipts.branch")}>
          {branches.isError ? (
            <span className="flex flex-wrap items-center gap-2 text-destructive">
              {t("payments.receipts.branchesError")}
              <Button size="sm" variant="outline" onClick={() => void branches.refetch()}>
                {t("common.tryAgain")}
              </Button>
            </span>
          ) : (
            branchNameIn(branches.data, p.branchId, pick)
          )}
        </Row>
        <Row label={t("payments.receipts.patient")}>{p.patientName}</Row>
        <Row label={t("payments.receipts.invoice")}>
          {invoiceLink ? (
            <Link
              to="/clinic/invoices/$invoiceId"
              params={{ invoiceId: p.invoiceId }}
              className="font-medium text-primary underline-offset-4 hover:underline"
              dir="ltr"
            >
              {p.invoiceNumber}
            </Link>
          ) : (
            <span dir="ltr">{p.invoiceNumber}</span>
          )}
        </Row>
        <Row label={t("payments.receipts.method")}>{t(`payments.method.${p.method}`)}</Row>
        <Row label={t("payments.receipts.reference")}>
          <span dir="ltr">{p.reference ?? "—"}</span>
        </Row>
        <Row label={t("payments.receipts.amount")}>
          <span className="font-semibold tabular-nums">
            {`${formatMinor(p.amountMinor, p.currencyExponent)} ${p.currency}`}
          </span>
        </Row>
      </dl>
    </div>
  );
}
