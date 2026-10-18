import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatMinor } from "@eyadex/contracts/money";
import type { PriceList } from "@eyadex/contracts/finance";
import type { ClinicService } from "@eyadex/contracts/services";
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
import { minorOfText, priceOf, useRefreshPrices } from "./price-queries";

/** The service's base price in major units; an empty field removes the price (null). */
export function ServicePriceDialog({
  service,
  list,
  onClose,
}: {
  service: ClinicService | null;
  list: PriceList;
  onClose: () => void;
}) {
  const { t, tDynamic, pick } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const refresh = useRefreshPrices();
  const [text, setText] = useState("");
  useOncePerOpen(service?.id ?? null, () => {
    const minor = service ? priceOf(list, service.id).priceMinor : null;
    setText(minor === null ? "" : formatMinor(minor, list.currencyExponent));
  });
  const minor = minorOfText(text, list.currencyExponent);
  const valid = text.trim() === "" || minor !== null;
  const save = useMutation({
    mutationFn: () => api.finance.setServicePrice(persona, service!.id, minor),
    onSuccess: () => {
      refresh();
      toast.success(t("finance.prices.saved"));
      onClose();
    },
    onError: (e) => toast.error(tDynamic(`errors.${errorCodeOf(e)}`)),
  });
  const name = service ? pick(service.nameAr, service.nameEn) : "";
  return (
    <Dialog open={service !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("finance.prices.editTitle", { name })}</DialogTitle>
          <DialogDescription>
            {t("finance.prices.editBody", { currency: list.currency })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <Input
            value={text}
            inputMode="decimal"
            dir="ltr"
            aria-label={t("finance.prices.amount")}
            aria-invalid={!valid}
            onChange={(e) => setText(e.target.value)}
          />
          {!valid && (
            <p role="alert" className="text-sm text-destructive">
              {t("finance.prices.invalidAmount", { digits: list.currencyExponent })}
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
