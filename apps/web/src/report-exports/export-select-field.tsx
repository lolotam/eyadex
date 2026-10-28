import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ExportSelectOption = { value: string; label: string; disabled?: boolean | undefined };

/** One labelled export-form picker; the error and help text are tied to it for screen readers. */
export function ExportSelectField({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder,
  error,
  help,
}: {
  id: string;
  label: string;
  value: string;
  options: ExportSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  error?: ReactNode | undefined;
  help?: ReactNode | undefined;
}) {
  const described = [help ? `${id}-help` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled ?? false}>
        <SelectTrigger
          id={id}
          className="min-h-11 w-full bg-card md:min-h-9"
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled ?? false}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {help ? (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
