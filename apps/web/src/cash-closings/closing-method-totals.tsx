import type { PaymentMethod } from "@eyadex/contracts/finance";
import { formatMinor } from "@eyadex/contracts/money";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** Every method's in and out on the business day, labelled «للعلم فقط»: only cash is counted. */
export function ClosingMethodTotals({
  totals,
  exponent,
  currency,
}: {
  totals: readonly { method: PaymentMethod; inMinor: string; outMinor: string }[];
  exponent: number;
  currency: string;
}) {
  const { t } = useI18n();
  const money = (minor: string) => `${formatMinor(minor, exponent)} ${currency}`;
  return (
    <section className="rounded-md border p-3">
      <h3 className="mb-2 flex flex-wrap items-baseline gap-2 text-sm font-medium">
        {t("cashClosings.dialog.otherMethods")}
        <span className="text-xs font-normal text-muted-foreground">
          {t("cashClosings.dialog.infoOnly")}
        </span>
      </h3>
      <dl className="grid gap-1 text-sm">
        {totals.map((m) => (
          <div key={m.method} className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">{t(`payments.method.${m.method}`)}</dt>
            <dd className="tabular-nums">
              {`${t("cashClosings.dialog.in")} ${money(m.inMinor)} · ${t("cashClosings.dialog.out")} ${money(m.outMinor)}`}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
