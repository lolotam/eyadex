import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4 border-b pb-6">
      <div>
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
