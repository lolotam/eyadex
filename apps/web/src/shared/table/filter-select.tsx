import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ANY = "any";

/** One toolbar filter: "any" maps to null; without `anyLabel` a value is required and there is no "any". */
export function FilterSelect({
  value,
  anyLabel,
  options,
  onChange,
  label,
}: {
  value: string | null;
  anyLabel?: string;
  label: string;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  return (
    <Select
      // "" is Radix's "nothing chosen" for a required picker that has no value yet.
      value={value ?? (anyLabel === undefined ? "" : ANY)}
      onValueChange={(v) => onChange(v === ANY ? null : v)}
    >
      <SelectTrigger className="w-full bg-card sm:w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {anyLabel !== undefined && <SelectItem value={ANY}>{anyLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
