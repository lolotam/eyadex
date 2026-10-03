import type { Control, FieldValues, Path } from "react-hook-form";
import { useController } from "react-hook-form";
import type { BranchOption } from "@contracts/users";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useI18n } from "@/shared/i18n/i18n-provider";

type AccessValues = FieldValues & { allBranches: boolean; branchIds: string[] };

/** "All branches" or a multi-select of ACTIVE branches. */
export function BranchAccessField<T extends AccessValues>({
  control,
  branches,
}: {
  control: Control<T>;
  branches: BranchOption[];
}) {
  const { t, pick, tDynamic } = useI18n();
  const all = useController({ control, name: "allBranches" as Path<T> });
  const ids = useController({ control, name: "branchIds" as Path<T> });
  const selected: string[] = ids.field.value ?? [];
  const active = branches.filter((b) => b.isActive);
  const error = ids.fieldState.error?.message;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium">{t("users.fields.branchAccess")}</legend>
      <RadioGroup
        value={all.field.value ? "all" : "some"}
        onValueChange={(v) => all.field.onChange(v === "all")}
        className="flex flex-wrap gap-4"
      >
        <Label className="flex items-center gap-2 font-normal">
          <RadioGroupItem value="all" />
          {t("users.fields.allBranches")}
        </Label>
        <Label className="flex items-center gap-2 font-normal">
          <RadioGroupItem value="some" />
          {t("users.fields.someBranches")}
        </Label>
      </RadioGroup>
      {!all.field.value && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          {active.map((b) => (
            <Label key={b.id} className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={selected.includes(b.id)}
                onCheckedChange={(checked) =>
                  ids.field.onChange(
                    checked ? [...selected, b.id] : selected.filter((x) => x !== b.id),
                  )
                }
              />
              {pick(b.nameAr, b.nameEn)}
            </Label>
          ))}
        </div>
      )}
      {error && <p className="text-[0.8rem] font-medium text-destructive">{tDynamic(error)}</p>}
    </fieldset>
  );
}
