import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DEFAULT_PROVIDER_DURATION_MINUTES,
  bookingProfileInputSchema,
  type BookingProfileInput,
} from "@eyadex/contracts/services";
import type { MembershipUserView } from "@eyadex/contracts/users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { NumberField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";

const DEFAULTS: BookingProfileInput = {
  acceptsAppointments: false,
  defaultDurationMinutes: DEFAULT_PROVIDER_DURATION_MINUTES,
};

export function BookingProfileDialog({
  user,
  onClose,
}: {
  user: MembershipUserView | null;
  onClose: () => void;
}) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const queryKey = ["clinic", "users", "booking", user?.id, persona.clinicId] as const;
  const profile = useQuery({
    queryKey,
    queryFn: () => api.scheduling.getBookingProfile(persona, user?.id ?? ""),
    enabled: user !== null,
  });
  const form = useForm<BookingProfileInput>({
    resolver: zodResolver(bookingProfileInputSchema),
    defaultValues: DEFAULTS,
  });
  // A form left over from another member never shows, and never saves, as this member's values.
  useEffect(() => form.reset(DEFAULTS), [user?.id, form]);
  useEffect(() => {
    if (profile.data) {
      const { acceptsAppointments, defaultDurationMinutes } = profile.data;
      form.reset({ acceptsAppointments, defaultDurationMinutes });
    }
  }, [profile.data, form]);
  const mutation = useMutation({
    mutationFn: (input: BookingProfileInput) =>
      api.scheduling.setBookingProfile(persona, user?.id ?? "", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["clinic", "schedules"] });
      toast.success(t("bookingProfile.saved"));
      onClose();
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("bookingProfile.title")}</DialogTitle>
          <DialogDescription>
            {t("bookingProfile.subtitle", { name: user?.fullName ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="booking-profile-form"
            className="flex flex-col gap-5"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <FormField
              control={form.control}
              name="acceptsAppointments"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <div>
                    <FormLabel>{t("bookingProfile.accepts")}</FormLabel>
                    <FormDescription>{t("bookingProfile.acceptsHint")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <NumberField
              control={form.control}
              name="defaultDurationMinutes"
              label={t("bookingProfile.duration")}
              hint={t("bookingProfile.durationHint")}
            />
          </form>
        </Form>
        {profile.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t("bookingProfile.loadError")}
          </p>
        )}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="booking-profile-form"
            disabled={mutation.isPending || !profile.isSuccess}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
