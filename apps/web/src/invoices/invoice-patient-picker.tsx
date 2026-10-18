import { useState } from "react";
import { Search } from "lucide-react";
import { formatFileNumber } from "@eyadex/contracts/patients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/shared/forms/use-debounced-value";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePatientSearch } from "./invoice-options";

type Picked = { id: string; label: string };

/** Search and pick one patient file (manual invoices and the list's patient filter). */
export function InvoicePatientPicker({
  value,
  onChange,
}: {
  value: Picked | null;
  onChange: (picked: Picked | null) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const search = usePatientSearch(useDebouncedValue(q));
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
      {(search.data?.items.length ?? 0) > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-sm">
          {search.data!.items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-muted"
                onClick={() => {
                  onChange({
                    id: p.id,
                    label: `${p.fullName} · ${formatFileNumber(p.fileNumber)}`,
                  });
                  setQ("");
                }}
              >
                <span className="truncate">{p.fullName}</span>
                <span className="text-muted-foreground tabular-nums" dir="ltr">
                  {formatFileNumber(p.fileNumber)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
