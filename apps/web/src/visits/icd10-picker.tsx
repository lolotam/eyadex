import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useClinicPersona } from "./medical-queries";

type Props = {
  code: string;
  title: string;
  onPick: (pick: { code: string; title: string }) => void;
};

/** ICD-10-CM search (P2-F1): `code — English title` in both languages, with the CDC notice. */
export function Icd10Picker({ code, title, onPick }: Props) {
  const api = useApi();
  const { persona, enabled, personaKey } = useClinicPersona();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const results = useQuery({
    queryKey: ["clinic", "medical", "icd10", debounced, ...personaKey],
    queryFn: () => api.medical.searchIcd10(persona, debounced),
    enabled: enabled && open && debounced.length > 0,
    retry: false,
    gcTime: 0,
  });
  const items = results.data?.items ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
          aria-label={t("visit.icdPick")}
        >
          <span dir="ltr" className="truncate text-start">
            {code ? `${code} — ${title}` : t("visit.icdPick")}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-2" align="start">
        <Input
          autoFocus
          value={q}
          maxLength={60}
          dir="ltr"
          placeholder={t("visit.icdSearch")}
          aria-label={t("visit.icdSearch")}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="mt-2 max-h-60 overflow-y-auto" role="listbox">
          {debounced && !results.isLoading && items.length === 0 && (
            <li className="p-2 text-sm text-muted-foreground">{t("visit.icdNone")}</li>
          )}
          {items.map((item) => (
            <li key={item.code}>
              <button
                type="button"
                role="option"
                aria-selected={item.code === code}
                dir="ltr"
                className="w-full rounded-sm px-2 py-1.5 text-start text-sm hover:bg-muted"
                onClick={() => {
                  onPick(item);
                  setOpen(false);
                }}
              >
                <span className="font-medium">{item.code}</span> — {item.title}
              </button>
            </li>
          ))}
        </ul>
        <p dir="ltr" className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
          {t("visit.icdFooter")}
        </p>
      </PopoverContent>
    </Popover>
  );
}
