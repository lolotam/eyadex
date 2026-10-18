import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { invoicePrefixSchema } from "@eyadex/contracts/finance";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useOncePerOpen } from "@/shared/forms/use-once-per-open";
import { usePersona } from "@/shared/persona/persona-provider";
import { useRefreshFinanceSettings } from "./finance-queries";

export type PrefixTarget = { branchId: string; name: string; prefix: string };

/** Sets one branch's prefix; the API answers `invoice_prefix_taken` / `invoice_prefix_locked`. */
export function InvoicePrefixDialog({
  target,
  onClose,
}: {
  target: PrefixTarget | null;
  onClose: () => void;
}) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const refresh = useRefreshFinanceSettings();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  useOncePerOpen(target?.branchId ?? null, () => {
    setValue(target?.prefix ?? "");
    setError(null);
  });
  const save = useMutation({
    mutationFn: (prefix: string) => api.finance.setPrefix(persona, target!.branchId, prefix),
    onSuccess: () => {
      refresh();
      toast.success(t("finance.settings.prefixSaved"));
      onClose();
    },
    onError: (e) => setError(tDynamic(`errors.${errorCodeOf(e)}`)),
  });
  const valid = invoicePrefixSchema.safeParse(value).success;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("finance.settings.prefixTitle", { branch: target?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("finance.settings.prefixHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate(value);
          }}
        >
          <Input
            value={value}
            maxLength={6}
            dir="ltr"
            aria-label={t("finance.settings.prefix")}
            aria-invalid={!valid && value !== ""}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={!valid || save.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
