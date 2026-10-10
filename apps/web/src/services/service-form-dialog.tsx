import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DEFAULT_PROVIDER_DURATION_MINUTES,
  serviceInputSchema,
  type ClinicService,
  type ServiceInput,
} from "@eyadex/contracts/services";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { NumberField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { useRefreshServices } from "./service-queries";

const EMPTY: ServiceInput = {
  nameAr: "",
  nameEn: "",
  durationMinutes: DEFAULT_PROVIDER_DURATION_MINUTES,
};

export function ServiceFormDialog({
  open,
  service,
  onOpenChange,
}: {
  open: boolean;
  service: ClinicService | null;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshServices();
  const form = useForm<ServiceInput>({
    resolver: zodResolver(serviceInputSchema),
    defaultValues: EMPTY,
  });
  // One key per opening of the form: a retry of the same submit replays, a new form is a new service.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (open) setIdempotencyKey(crypto.randomUUID());
    form.reset(
      service
        ? {
            nameAr: service.nameAr,
            nameEn: service.nameEn,
            durationMinutes: service.durationMinutes,
          }
        : EMPTY,
    );
  }, [open, service, form]);

  const mutation = useMutation({
    mutationFn: (input: ServiceInput) =>
      service
        ? api.scheduling.updateService(persona, service.id, input)
        : api.scheduling.createService(persona, input, idempotencyKey),
    onSuccess: () => {
      refresh();
      toast.success(t(service ? "services.updated" : "services.created"));
      onOpenChange(false);
    },
    onError: (error) => toast.error(t(`errors.${errorCodeOf(error)}`)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t(service ? "services.editTitle" : "services.createTitle")}</DialogTitle>
          <DialogDescription>{t("services.formSubtitle")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="service-form"
            className="flex flex-col gap-5 py-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <TextField
              control={form.control}
              name="nameAr"
              label={t("services.fields.nameAr")}
              dir="rtl"
            />
            <TextField
              control={form.control}
              name="nameEn"
              label={t("services.fields.nameEn")}
              dir="ltr"
            />
            <NumberField
              control={form.control}
              name="durationMinutes"
              label={t("services.fields.durationMinutes")}
              hint={t("services.fields.durationHint")}
            />
          </form>
        </Form>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="service-form" disabled={mutation.isPending}>
            {service ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
