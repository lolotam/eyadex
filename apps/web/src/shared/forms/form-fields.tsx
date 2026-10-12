import type { Control, FieldPath, FieldValues } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  useFormField,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/shared/i18n/i18n-provider";

/** Shows a field's validation message translated from its i18n key. */
export function FieldError() {
  const { error, formMessageId } = useFormField();
  const { tDynamic } = useI18n();
  if (!error?.message) return null;
  return (
    <p id={formMessageId} className="text-[0.8rem] font-medium text-destructive">
      {tDynamic(error.message)}
    </p>
  );
}

type BaseProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  hint?: string;
  disabled?: boolean;
};

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  disabled,
  type = "text",
  dir,
}: BaseProps<T> & { type?: string; dir?: "ltr" | "rtl" }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              type={type}
              disabled={disabled}
              {...(dir ? { dir } : {})}
              value={field.value ?? ""}
            />
          </FormControl>
          {hint && <FormDescription>{hint}</FormDescription>}
          <FieldError />
        </FormItem>
      )}
    />
  );
}

export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  disabled,
}: BaseProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              inputMode="numeric"
              disabled={disabled}
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              value={Number.isNaN(field.value) ? "" : field.value}
              onChange={(e) => field.onChange(e.target.valueAsNumber)}
            />
          </FormControl>
          {hint && <FormDescription>{hint}</FormDescription>}
          <FieldError />
        </FormItem>
      )}
    />
  );
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  disabled,
  options,
}: BaseProps<T> & { options: { value: string; label: string }[] }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select value={field.value} onValueChange={field.onChange} disabled={disabled ?? false}>
            <FormControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError />
        </FormItem>
      )}
    />
  );
}

/** An on/off value as a bordered row: label and hint at the start, the switch at the end. */
export function SwitchField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  disabled,
}: BaseProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-center justify-between gap-4 space-y-0 rounded-lg border p-4">
          <div className="flex flex-col gap-1">
            <FormLabel>{label}</FormLabel>
            {hint && <FormDescription>{hint}</FormDescription>}
            <FieldError />
          </div>
          <FormControl>
            <Switch
              checked={field.value === true}
              onCheckedChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
              disabled={disabled ?? false}
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}
