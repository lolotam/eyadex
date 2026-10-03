import type { AuditCategory } from "@contracts/audit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { AuditCategoryBadge } from "./audit-category-badge";
import { auditDiff } from "./audit-diff";
import { formatAuditTime } from "./audit-time";

export type AuditDetailEntry = {
  at: string;
  actorName: string;
  action: string;
  entity: string;
  category: AuditCategory;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

type Props = { entry: AuditDetailEntry | null; timeZone: string; onClose: () => void };

/** A dialog rather than a side sheet: sheets clip on mobile in RTL (project rule). */
export function AuditDetailDialog({ entry, timeZone, onClose }: Props) {
  const { t, tDynamic, lang, pick } = useI18n();
  const rows = entry ? auditDiff(entry.before, entry.after) : [];
  // Names come resolved from the API ({ nameAr, nameEn }); coded values are translated.
  const one = (value: unknown): string => {
    if (value && typeof value === "object" && "nameAr" in value && "nameEn" in value) {
      const named = value as { nameAr: unknown; nameEn: unknown };
      return pick(String(named.nameAr), String(named.nameEn));
    }
    if (typeof value === "object") return "—";
    const text = String(value);
    const key = `audit.values.${text}`;
    const translated = tDynamic(key);
    return translated === key ? text : translated;
  };
  const show = (value: unknown): string => {
    if (value === undefined || value === null || value === "") return "—";
    if (typeof value === "boolean") return t(value ? "audit.yes" : "audit.no");
    if (Array.isArray(value)) return value.length ? value.map(one).join("، ") : "—";
    return one(value);
  };
  const label = (field: string) => {
    const text = tDynamic(`audit.fields.${field}`);
    return text === `audit.fields.${field}` ? field : text;
  };

  return (
    <Dialog open={Boolean(entry)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-2xl">
        <DialogHeader className="text-start">
          <DialogTitle>{entry ? tDynamic(`audit.actions.${entry.action}`) : ""}</DialogTitle>
          <DialogDescription>
            {entry ? `${entry.actorName} · ${formatAuditTime(entry.at, lang, timeZone)}` : ""}
          </DialogDescription>
        </DialogHeader>
        {entry && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("audit.columns.entity")}:</span>
            <span className="font-medium">{tDynamic(`audit.entities.${entry.entity}`)}</span>
            <AuditCategoryBadge category={entry.category} />
          </div>
        )}
        {rows.length === 0 ? (
          <p className="rounded-md border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
            {t("audit.noDetails")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-muted/70 text-start">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t("audit.diff.field")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("audit.diff.before")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("audit.diff.after")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.field} className={row.changed ? "bg-accent/40" : undefined}>
                    <td className="border-t px-3 py-2 font-medium">{label(row.field)}</td>
                    <td className="border-t px-3 py-2 break-all text-muted-foreground">
                      {show(row.before)}
                    </td>
                    <td className="border-t px-3 py-2 break-all">{show(row.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
