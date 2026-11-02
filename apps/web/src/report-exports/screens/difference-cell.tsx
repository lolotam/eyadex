import { useI18n } from "@/shared/i18n/i18n-provider";
import { SignedAmount } from "./signed-amount";

/** A difference: the minus sign plus a shortage/over word, so the meaning never rests on colour. */
export function DifferenceCell({ minor, text }: { minor: string; text: string }) {
  const { t } = useI18n();
  const word = minor.startsWith("-")
    ? t("financeReports.cashClosings.shortage")
    : /^0+$/.test(minor)
      ? null
      : t("financeReports.cashClosings.over");
  return (
    <span className="inline-flex items-center gap-1">
      <SignedAmount minor={minor} text={text} />
      {word ? <span className="text-xs text-muted-foreground">({word})</span> : null}
    </span>
  );
}
