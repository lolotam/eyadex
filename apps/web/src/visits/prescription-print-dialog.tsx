import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useClinicPersona } from "@/medical/medical-queries";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PrescriptionPrintView } from "./prescription-print-view";

/** Each opening reads the print data once (audited); the print stylesheet prints only the sheet. */
export function PrescriptionPrintDialog({
  visitId,
  open,
  onOpenChange,
}: {
  visitId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useApi();
  const { persona, enabled, personaKey } = useClinicPersona();
  const { session } = useSession();
  const { t } = useI18n();
  const print = useQuery({
    queryKey: ["clinic", "medical", "print", visitId, ...personaKey],
    queryFn: () => api.medical.getPrescriptionPrint(persona, visitId),
    enabled: enabled && open,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="prescription-print-dialog max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-xl">
        <DialogHeader className="text-start print:hidden">
          <DialogTitle>{t("visit.print")}</DialogTitle>
        </DialogHeader>
        {print.isLoading ? (
          <LoadingBlock />
        ) : print.data ? (
          <PrescriptionPrintView
            data={print.data}
            timeZone={session?.clinic?.timezone ?? "Asia/Kuwait"}
          />
        ) : (
          <p className="text-sm text-destructive">{t(`errors.${errorCodeOf(print.error)}`)}</p>
        )}
        <DialogFooter className="gap-2 sm:space-x-0 print:hidden">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("printView.close")}
          </Button>
          <Button disabled={!print.data} onClick={() => window.print()}>
            <Printer className="size-4" />
            {t("printView.printNow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
