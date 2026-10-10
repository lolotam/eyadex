import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { VISIT_CANCEL_REASONS, visitCancelSchema } from "@eyadex/contracts/visits";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useVisitWrite } from "./use-visit-write";

type Values = z.input<typeof visitCancelSchema>;

/** Cancel a draft (P2-6): a reason and an optional note; the draft is kept as cancelled. */
export function VisitCancelDialog({
  visitId,
  open,
  onOpenChange,
}: {
  visitId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const form = useForm<Values>({
    resolver: zodResolver(visitCancelSchema),
    defaultValues: { reason: "opened_by_mistake", note: null },
  });
  useEffect(() => {
    if (open) form.reset({ reason: "opened_by_mistake", note: null });
  }, [open, form]);
  const cancel = useVisitWrite<Values>(
    visitId,
    (api, persona, input) =>
      api.cancelVisit(persona, visitId, { reason: input.reason, note: input.note ?? null }),
    { success: "visit.cancelled", onDone: () => onOpenChange(false) },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-lg sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("visit.cancelTitle")}</DialogTitle>
          <DialogDescription>{t("visit.cancelBody")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="visit-cancel-form"
            className="flex flex-col gap-4 py-2"
            onSubmit={form.handleSubmit((v) => cancel.mutate(v))}
          >
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("visit.cancelReason")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {VISIT_CANCEL_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {t(`visit.cancelReasons.${r}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("visit.cancelNote")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      maxLength={300}
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(e.target.value === "" ? null : e.target.value)
                      }
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("visit.keepDraft")}
          </Button>
          <Button
            type="submit"
            form="visit-cancel-form"
            variant="destructive"
            disabled={cancel.isPending}
          >
            {t("visit.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
