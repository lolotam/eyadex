import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { minorOfText, priceOf, useRefreshPrices } from "./price-queries";

type Row = { memberId: string; text: string };

/** The whole per-doctor price list of one service, saved at once (PUT replaces it). */
export function ProviderPricesDialog({
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
  const exp = list.currencyExponent;
  const [rows, setRows] = useState<Row[]>([]);
  const providers = useQuery({
    queryKey: ["clinic", "prices", "providers", persona.memberId],
    queryFn: () => api.scheduling.listProviders(persona),
    enabled: service !== null,
  });
  useEffect(() => {
    if (!service) return;
    setRows(
      priceOf(list, service.id).providerPrices.map((p) => ({
        memberId: p.memberId,
        text: formatMinor(p.priceMinor, exp),
      })),
    );
  }, [service, list, exp]);
  const parsed = rows.map((r) => ({ memberId: r.memberId, priceMinor: minorOfText(r.text, exp) }));
  const valid = parsed.every((r) => r.memberId !== "" && r.priceMinor !== null);
  const save = useMutation({
    mutationFn: () =>
      api.finance.setProviderPrices(
        persona,
        service!.id,
        parsed.map((r) => ({ memberId: r.memberId, priceMinor: r.priceMinor! })),
      ),
    onSuccess: () => {
      refresh();
      toast.success(t("finance.prices.providersSaved"));
      onClose();
    },
    onError: (e) => toast.error(tDynamic(`errors.${errorCodeOf(e)}`)),
  });
  const all = providers.data ?? [];
  const taken = new Set(rows.map((r) => r.memberId));
  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const name = service ? pick(service.nameAr, service.nameEn) : "";
  return (
    <Dialog open={service !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("finance.prices.providersTitle", { name })}</DialogTitle>
          <DialogDescription>{t("finance.prices.providersBody")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={row.memberId} onValueChange={(v) => update(i, { memberId: v })}>
                <SelectTrigger className="flex-1" aria-label={t("finance.prices.doctor")}>
                  <SelectValue placeholder={t("finance.prices.doctor")} />
                </SelectTrigger>
                <SelectContent>
                  {all
                    .filter((p) => p.membershipId === row.memberId || !taken.has(p.membershipId))
                    .map((p) => (
                      <SelectItem key={p.membershipId} value={p.membershipId}>
                        {p.fullName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Input
                className="w-32"
                value={row.text}
                inputMode="decimal"
                dir="ltr"
                aria-label={t("finance.prices.amount")}
                aria-invalid={minorOfText(row.text, exp) === null}
                onChange={(e) => update(i, { text: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("finance.prices.remove")}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={taken.size >= all.length && rows.length > 0}
            onClick={() => setRows((rs) => [...rs, { memberId: "", text: "" }])}
          >
            <Plus className="size-4" />
            {t("finance.prices.addDoctor")}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
