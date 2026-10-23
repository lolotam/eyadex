import type { CashClosingPreview } from "@eyadex/contracts/finance";
import { formatMinor, formatSignedMinor } from "@eyadex/contracts/money";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ClosingMethodTotals } from "./closing-method-totals";
import { ClosingMovements } from "./closing-movements";

/** The preview the count is compared with: period, cash in/out, the expected amount and its movements. */
export function ClosingPreviewSummary({ preview }: { preview: CashClosingPreview }) {
  const { t } = useI18n();
  const { currency, currencyExponent: exp } = preview;
  const money = (minor: string) => `${formatMinor(minor, exp)} ${currency}`;
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        {preview.previousClosingId === null
          ? t("cashClosings.dialog.firstPeriod")
          : t("cashClosings.dialog.period", {
              from: String(BigInt(preview.fromCashSeq) + 1n),
              through: preview.throughCashSeq,
            })}
      </p>
      <dl className="grid grid-cols-3 gap-2 rounded-md border p-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("cashClosings.dialog.cashIn")}</dt>
          <dd className="tabular-nums" dir="ltr">
            {money(preview.cashInMinor)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("cashClosings.dialog.cashOut")}</dt>
          <dd className="tabular-nums" dir="ltr">
            {money(preview.cashOutMinor)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("cashClosings.expected")}</dt>
          <dd className="font-semibold tabular-nums" dir="ltr">
            {`${formatSignedMinor(preview.expectedMinor, exp)} ${currency}`}
          </dd>
        </div>
      </dl>
      <h3 className="text-sm font-medium">{t("cashClosings.dialog.movements")}</h3>
      <ClosingMovements movements={preview.movements} exponent={exp} currency={currency} />
      <ClosingMethodTotals totals={preview.methodTotals} exponent={exp} currency={currency} />
    </div>
  );
}
