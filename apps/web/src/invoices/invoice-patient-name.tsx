import { UserRound } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";

/**
 * The name comes with the invoice detail (`patientName`), so opening an invoice is not a patient-file
 * open. A missing name shows the neutral «المراجع» / "Patient", never an empty cell.
 */
export function InvoicePatientName({ name }: { name: string | undefined }) {
  const { t } = useI18n();
  return (
    <p className="mb-4 flex items-center gap-2 text-sm">
      <UserRound className="size-4 text-muted-foreground" />
      <span className="text-muted-foreground">{t("finance.list.patient")}:</span>
      <span className="font-medium">{name?.trim() ? name : t("finance.patientFallback")}</span>
    </p>
  );
}
