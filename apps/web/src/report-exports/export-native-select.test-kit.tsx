import type { ReactNode } from "react";

// A native select stands in for the Radix picker, which jsdom cannot open; ids and aria pass through.
export function NativeSelect = (p: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  error?: ReactNode;
}) {
  return (
  <div>
    <label htmlFor={p.id}>{p.label}</label>
    <select
      id={p.id}
      value={p.value}
      disabled={p.disabled}
      aria-invalid={p.error ? true : undefined}
      aria-describedby={p.error ? `${p.id}-error` : undefined}
      onChange={(e) => p.onChange(e.target.value)}
    >
      <option value="">{p.placeholder ?? ""}</option>
      {p.options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
    {p.error ? <p id={`${p.id}-error`}>{p.error}</p> : null}
  </div>

  );
}
