import { Ban, CheckCircle2 } from "lucide-react";
import type { Invoice } from "@eyadex/contracts/finance";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** Icon + label + subtle tint, never color alone. */
export function InvoiceStatusBadge({ status }: { status: Invoice["status"] }) {
  const { t } = useI18n();
  const Icon = status === "issued" ? CheckCircle2 : Ban;
  return (
    <Badge
      variant={status === "issued" ? "default" : "secondary"}
      className="gap-1.5 whitespace-nowrap"
    >
      <Icon className="size-3" />
      {t(`finance.status.${status}`)}
    </Badge>
  );
}
