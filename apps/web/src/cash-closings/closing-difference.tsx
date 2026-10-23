import { CircleCheck, TriangleAlert } from "lucide-react";
import { formatSignedMinor } from "@eyadex/contracts/money";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { differenceKind } from "./closing-count";

/** A closing's difference: icon + label + tint (never color alone) and the signed amount. */
export function ClosingDifference({
  differenceMinor,
  exponent,
  currency,
}: {
  differenceMinor: string;
  exponent: number;
  currency: string;
}) {
  const { t } = useI18n();
  const kind = differenceKind(BigInt(differenceMinor));
  const Icon = kind === "balanced" ? CircleCheck : TriangleAlert;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge
        variant="outline"
        className={
          kind === "balanced"
            ? "gap-1.5 whitespace-nowrap"
            : "gap-1.5 whitespace-nowrap border-destructive/40 text-destructive"
        }
      >
        <Icon className="size-3.5" />
        {t(`cashClosings.diff.${kind}`)}
      </Badge>
      {kind !== "balanced" && (
        <span className="whitespace-nowrap tabular-nums" dir="ltr">
          {`${formatSignedMinor(differenceMinor, exponent)} ${currency}`}
        </span>
      )}
    </span>
  );
}
