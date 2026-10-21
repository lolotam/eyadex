import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useDebouncedValue } from "@/shared/forms/use-debounced-value";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";

type Picked = { id: string; label: string };

/**
 * The receipts list's patient filter. Mounted only for a `view:patients` holder: the search is the
 * patients list, which needs that key; the receipts themselves never do.
 */
export function ReceiptPatientPicker({
  value,
  onChange,
}: {
  value: Picked | null;
  onChange: (picked: Picked | null) => void;
}) {
  const { t } = useI18n();
  const api = useApi();
  const { persona, ready } = usePersona();
  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q).trim();
  const search = useQuery({
    queryKey: ["clinic", "receipt-patients", debounced, persona.memberId],
    queryFn: () =>
      api.patients.list(persona, {
        cursor: null,
        limit: 10,
        q: debounced,
        branchId: null,
        status: "active",
      }),
    enabled: ready && Boolean(persona.clinicId) && debounced.length >= 2,
    retry: (count, error) => !(error instanceof ApiError) && count < 2,
  });
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
        <span className="truncate">{value.label}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          {t("finance.invoice.change")}
        </Button>
      </div>
    );
  }
  const items = q.trim() === debounced && debounced.length >= 2 ? (search.data?.items ?? []) : [];
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="ps-8"
        aria-label={t("finance.invoice.pickPatient")}
        placeholder={t("finance.invoice.pickPatient")}
      />
      {items.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-sm">
          {items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full truncate px-3 py-2 text-start text-sm hover:bg-muted"
                onClick={() => {
                  onChange({ id: p.id, label: p.fullName });
                  setQ("");
                }}
              >
                {p.fullName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
