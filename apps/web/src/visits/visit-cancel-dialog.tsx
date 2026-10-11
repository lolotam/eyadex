import { useEffect, useState } from "react";
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

/**
 * Cancel a draft (P2-6): a reason and an optional note; the draft is kept as cancelled. The confirm sends
 * the note's pending text and waits for every section save (`settleSaves`, as Sign), and cancels only
 * when all of them succeeded: a save landing after the cancel would be refused and its text lost.
 */
export function VisitCancelDialog({
  visitId,
  open,
  onOpenChange,
  settleSaves,
}: {
  visitId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settleSaves: () => Promise<void>;
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
  const [settling, setSettling] = useState(false);
  const busy = settling || cancel.isPending;
  const confirm = async (values: Values) => {
    setSettling(true);
    try {
      await settleSaves();
    } catch {
      // The failed save already showed its error; the dialog stays open and nothing is cancelled.
      return;
    } finally {
      setSettling(false);
    }
    cancel.mutate(values);
  };
  // Closing while the confirm waits would not stop the cancel it is about to send, so it is refused.
  const close = (next: boolean) => {
    if (!busy || next) onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-lg sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("visit.cancelTitle")}</DialogTitle>
          <DialogDescription>{t("visit.cancelBody")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="visit-cancel-form"
            className="flex flex-col gap-4 py-2"
            onSubmit={form.handleSubmit(confirm)}
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
          <Button type="button" variant="outline" disabled={busy} onClick={() => close(false)}>
            {t("visit.keepDraft")}
          </Button>
          <Button type="submit" form="visit-cancel-form" variant="destructive" disabled={busy}>
            {t("visit.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
