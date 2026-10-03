import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  clinicStatusSchema,
  subscriptionInputSchema,
  type ClinicDetail,
  type SubscriptionInput,
} from "@eyadex/contracts/clinics";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { NumberField, SelectField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { clinicKeys } from "./clinic-queries";
import { ClinicUsageCard } from "./clinic-usage-card";

export function ClinicSubscriptionTab({ clinic }: { clinic: ClinicDetail }) {
  const { t, formatDate } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const queryClient = useQueryClient();
  const form = useForm<SubscriptionInput>({
    resolver: zodResolver(subscriptionInputSchema),
    defaultValues: {
      status: clinic.status,
      expiryMode: "duration",
      durationMonths: 12,
      expiresOn: clinic.expiresAt.slice(0, 10),
      maxUsers: clinic.maxUsers,
      maxBranches: clinic.maxBranches,
    },
  });
  const mode = form.watch("expiryMode");

  const mutation = useMutation({
    mutationFn: (input: SubscriptionInput) =>
      api.platform.updateSubscription(persona, clinic.id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clinicKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      toast.success(t("clinics.subscription.saved"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
              className="flex flex-col gap-5"
            >
              <SelectField
                control={form.control}
                name="status"
                label={t("clinics.subscription.status")}
                options={clinicStatusSchema.options.map((s) => ({
                  value: s,
                  label: t(`clinicStatus.${s}`),
                }))}
              />
              <FormField
                control={form.control}
                name="expiryMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("clinics.subscription.expiry")}</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      {t("clinics.subscription.currentExpiry", {
                        date: formatDate(clinic.expiresAt),
                      })}
                    </p>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      className="flex flex-wrap gap-4"
                    >
                      <Label className="flex items-center gap-2 font-normal">
                        <RadioGroupItem value="duration" /> {t("clinics.subscription.byDuration")}
                      </Label>
                      <Label className="flex items-center gap-2 font-normal">
                        <RadioGroupItem value="date" /> {t("clinics.subscription.byDate")}
                      </Label>
                    </RadioGroup>
                  </FormItem>
                )}
              />
              {mode === "duration" ? (
                <NumberField
                  control={form.control}
                  name="durationMonths"
                  label={t("clinics.subscription.durationMonths")}
                />
              ) : (
                <TextField
                  control={form.control}
                  name="expiresOn"
                  label={t("clinics.subscription.expiresOn")}
                  type="date"
                />
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  control={form.control}
                  name="maxUsers"
                  label={t("clinics.subscription.maxUsers")}
                />
                <NumberField
                  control={form.control}
                  name="maxBranches"
                  label={t("clinics.subscription.maxBranches")}
                />
              </div>
              <div>
                <Button type="submit" disabled={mutation.isPending}>
                  {t("common.save")}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
      <ClinicUsageCard clinic={clinic} />
    </div>
  );
}
