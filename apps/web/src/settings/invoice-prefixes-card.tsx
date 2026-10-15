import { useState } from "react";
import { Lock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { useInvoicePrefixes } from "./finance-queries";
import { InvoicePrefixDialog, type PrefixTarget } from "./invoice-prefix-dialog";

/** One row per branch: its prefix, or "Not set"; a locked prefix is read-only (spec §8 rule 9). */
export function InvoicePrefixesCard() {
  const { t, pick } = useI18n();
  const prefixes = useInvoicePrefixes(true);
  const api = useApi();
  const { persona } = usePersona();
  const branches = useQuery({
    queryKey: ["clinic", "branches", "prefix-names", persona.clinicId],
    queryFn: () =>
      api.branches.list(persona, { cursor: null, limit: 100, search: "", status: null }),
  });
  const [target, setTarget] = useState<PrefixTarget | null>(null);
  const nameOf = (id: string) => {
    const b = branches.data?.items.find((x) => x.id === id);
    return b ? pick(b.nameAr, b.nameEn) : id;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("finance.settings.prefixes")}</CardTitle>
        <CardDescription>{t("finance.settings.prefixesBody")}</CardDescription>
      </CardHeader>
      <CardContent>
        {prefixes.isLoading ? (
          <LoadingBlock />
        ) : (
          <ul className="divide-y rounded-md border">
            {(prefixes.data ?? []).map((item) => (
              <li
                key={item.branchId}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{nameOf(item.branchId)}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">
                    {item.invoicePrefix ?? t("finance.settings.noPrefix")}
                  </div>
                </div>
                {item.locked ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="size-3.5" />
                    {t("finance.settings.locked")}
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setTarget({
                        branchId: item.branchId,
                        name: nameOf(item.branchId),
                        prefix: item.invoicePrefix ?? "",
                      })
                    }
                  >
                    <Pencil className="size-4" />
                    {t("finance.settings.setPrefix")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <InvoicePrefixDialog target={target} onClose={() => setTarget(null)} />
    </Card>
  );
}
