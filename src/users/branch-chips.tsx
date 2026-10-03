import type { BranchOption } from "@contracts/users";
import { useI18n } from "@/shared/i18n/i18n-provider";

const MAX_CHIPS = 2;

export function BranchChips({
  allBranches,
  branchIds,
  branches,
}: {
  allBranches: boolean;
  branchIds: string[];
  branches: BranchOption[];
}) {
  const { t, pick } = useI18n();
  if (allBranches) return <span className="whitespace-nowrap text-sm">{t("users.allBranches")}</span>;
  const names = branchIds.map((id) => {
    const b = branches.find((x) => x.id === id);
    return b ? pick(b.nameAr, b.nameEn) : "—";
  });
  const rest = names.length - MAX_CHIPS;
  return (
    <div className="flex flex-wrap gap-1">
      {names.slice(0, MAX_CHIPS).map((name, i) => (
        <span key={`${name}-${i}`} className="rounded-sm border bg-muted/60 px-1.5 py-0.5 text-xs">
          {name}
        </span>
      ))}
      {rest > 0 && (
        <span className="rounded-sm border px-1.5 py-0.5 text-xs text-muted-foreground">
          {t("users.moreBranches", { count: rest })}
        </span>
      )}
    </div>
  );
}
