import type { CashMovement } from "@eyadex/contracts/finance";
import { instantToWall } from "@eyadex/contracts/clinic-time";
import { formatMinor } from "@eyadex/contracts/money";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";

/** A period's cash movements by drawer position: number, kind, time, signed amount — no patient. */
export function ClosingMovements({
  movements,
  exponent,
  currency,
}: {
  movements: readonly CashMovement[];
  exponent: number;
  currency: string;
}) {
  const { t } = useI18n();
  const { session } = useSession();
  const zone = session?.clinic?.timezone ?? "UTC";
  if (movements.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("cashClosings.dialog.noMovements")}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[420px] text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-start font-medium">{t("cashClosings.dialog.seq")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("cashClosings.dialog.number")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("cashClosings.dialog.time")}</th>
            <th className="px-3 py-2 text-end font-medium">{t("cashClosings.dialog.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={`${m.kind}:${m.cashSeq}`} className="border-t">
              <td className="px-3 py-2 tabular-nums" dir="ltr">
                {m.cashSeq}
              </td>
              <td className="px-3 py-2">
                <span className="me-2 text-muted-foreground">
                  {t(`cashClosings.movement.${m.kind}`)}
                </span>
                <span dir="ltr">{m.kind === "payment" ? m.receiptNumber : m.refundNumber}</span>
              </td>
              <td className="px-3 py-2 tabular-nums" dir="ltr">
                {instantToWall(m.at, zone).time}
              </td>
              <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                {`${m.kind === "refund" ? "-" : ""}${formatMinor(m.amountMinor, exponent)} ${currency}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
