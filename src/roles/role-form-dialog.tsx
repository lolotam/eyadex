import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Lock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { roleInputSchema, type RoleListItem } from "@contracts/roles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { useApi } from "@/shared/api/api-provider";
import { ApiError, errorCodeOf } from "@/shared/api/api-error";
import { TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PermissionMatrix } from "./permission-matrix";
import { usePermissionCatalog, useRefreshRoles } from "./role-queries";

const namesSchema = roleInputSchema.pick({ nameAr: true, nameEn: true });
type Names = { nameAr: string; nameEn: string };

type Props = {
  open: boolean;
  role: RoleListItem | null;
  readOnly: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RoleFormDialog({ open, role, readOnly, onOpenChange }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshRoles();
  const catalog = usePermissionCatalog();
  const [keys, setKeys] = useState<string[]>([]);
  const form = useForm<Names>({
    resolver: zodResolver(namesSchema),
    defaultValues: { nameAr: "", nameEn: "" },
  });

  useEffect(() => {
    form.reset({ nameAr: role?.nameAr ?? "", nameEn: role?.nameEn ?? "" });
    setKeys(role?.permissionKeys ?? []);
  }, [role, form, open]);

  const mutation = useMutation({
    mutationFn: (names: Names) => {
      const input = { ...names, permissionKeys: keys };
      return role ? api.roles.update(persona, role.id, input) : api.roles.create(persona, input);
    },
    onSuccess: () => {
      refresh();
      toast.success(t(role ? "roles.updated" : "roles.created"));
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(
        t(`errors.${errorCodeOf(error)}`, error instanceof ApiError ? error.details : undefined),
      ),
  });

  const title =
    readOnly && role ? "roles.viewTitle" : role ? "roles.editTitle" : "roles.createTitle";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-2xl">
        <DialogHeader className="text-start">
          <DialogTitle>{t(title)}</DialogTitle>
          <DialogDescription>{t("roles.formSubtitle")}</DialogDescription>
        </DialogHeader>
        {role?.isLocked && (
          <p className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
            <Lock className="mt-0.5 size-4 shrink-0" />
            {t("roles.lockedNote")}
          </p>
        )}
        <Form {...form}>
          <form
            id="role-form"
            className="flex flex-col gap-5 py-2"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="nameAr"
                label={t("roles.fields.nameAr")}
                dir="rtl"
              />
              <TextField
                control={form.control}
                name="nameEn"
                label={t("roles.fields.nameEn")}
                dir="ltr"
              />
            </fieldset>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t("roles.matrixTitle")}</h3>
              {catalog.data ? (
                <PermissionMatrix
                  catalog={catalog.data}
                  value={keys}
                  onChange={setKeys}
                  readOnly={readOnly}
                />
              ) : (
                <LoadingBlock />
              )}
            </div>
          </form>
        </Form>
        {!readOnly && role && role.memberCount > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 text-destructive px-3 py-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {t("roles.membersWarning", { count: role.memberCount })}
          </p>
        )}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          {!readOnly && (
            <Button type="submit" form="role-form" disabled={mutation.isPending}>
              {role ? t("common.save") : t("common.create")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
