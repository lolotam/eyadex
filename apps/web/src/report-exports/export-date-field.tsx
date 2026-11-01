import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  id: string;
  label: string;
  value: string;
  helpId: string;
  error: string | null;
  disabled: boolean;
  onChange: (value: string) => void;
};

/** One clinic-calendar day: the native value is already `YYYY-MM-DD`, never converted to UTC. */
export function ExportDateField({ id, label, value, helpId, error, disabled, onChange }: Props) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        required
        className="min-h-11 bg-card md:min-h-9"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${helpId} ${id}-error` : helpId}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
