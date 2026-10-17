import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";

/**
 * The invoice carries `patientId` only: the name is read from the patient file the caller can
 * normally see. A refusal (403/404) or any other failure shows «مراجع» with no name.
 */
export function InvoicePatientName({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const api = useApi();
  const { persona, ready } = usePersona();
  const query = useQuery({
    queryKey: ["clinic", "invoices", "patient-name", patientId, persona.memberId],
    queryFn: async () => (await api.patients.open(persona, patientId)).fullName,
    enabled: ready && Boolean(persona.clinicId),
    retry: false,
    staleTime: 60_000,
  });
  return (
    <p className="mb-4 flex items-center gap-2 text-sm">
      <UserRound className="size-4 text-muted-foreground" />
      <span className="text-muted-foreground">{t("finance.list.patient")}:</span>
      <span className="font-medium">{query.data ?? t("finance.patientFallback")}</span>
    </p>
  );
}
