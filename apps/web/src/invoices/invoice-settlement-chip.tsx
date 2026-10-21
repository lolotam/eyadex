import { CircleCheck, CircleDashed, CircleDot } from "lucide-react";
import type { InvoiceSettlement } from "@eyadex/contracts/finance";
import { useI18n } from "@/shared/i18n/i18n-provider";

const LOOK = {
  unpaid: { icon: CircleDashed, tint: "border-destructive/30 bg-destructive/5 text-destructive" },
  partly_paid: { icon: CircleDot, tint: "border-border bg-muted text-foreground" },
  paid: { icon: CircleCheck, tint: "border-primary/30 bg-primary/5 text-primary" },
} as const;

/** The settlement state as icon + label + tint (never colour alone); nothing on a void invoice. */
export function InvoiceSettlementChip({
  settlement,
}: {
  settlement?: InvoiceSettlement | null | undefined;
}) {
  const { t } = useI18n();
  if (!settlement) return null;
  const { icon: Icon, tint } = LOOK[settlement.state];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${tint}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(`payments.state.${settlement.state}`)}
    </span>
  );
}
