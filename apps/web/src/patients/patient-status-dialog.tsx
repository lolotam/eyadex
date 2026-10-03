import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatFileNumber, type PatientStatus } from "@eyadex/contracts/patients";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useApi } from "@/shared/api/api-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { useRefreshPatients } from "./patient-queries";

export type PatientStatusTarget = {
  id: string;
  fileNumber: number;
  fullName: string;
  status: PatientStatus;
};

export function PatientStatusDialog({
  patient,
  onClose,
}: {
  patient: PatientStatusTarget | null;
  onClose: () => void;
}) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshPatients();
  const archiving = patient?.status === "active";
  const mutation = useMutation({
    mutationFn: () => {
      if (!patient) return Promise.reject(new Error("Missing patient"));
      return archiving
        ? api.patients.archive(persona, patient.id)
        : api.patients.restore(persona, patient.id);
    },
    onSuccess: (result) => {
      refresh(result);
      toast.success(t(archiving ? "patients.archived" : "patients.restored"));
      onClose();
    },
    onError: (error) => toast.error(t(`errors.${errorCodeOf(error)}`)),
  });

  return (
    <AlertDialog
      open={Boolean(patient)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader className="text-start">
          <AlertDialogTitle>
            {t(archiving ? "patients.archiveTitle" : "patients.restoreTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {patient ? `${formatFileNumber(patient.fileNumber)} · ${patient.fullName} — ` : ""}
            {t(archiving ? "patients.archiveBody" : "patients.restoreBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
          >
            {t(archiving ? "patients.archive" : "patients.restore")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
