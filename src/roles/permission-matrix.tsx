import {
  actionSchema,
  type PermissionDefinition,
  type PermissionResource,
} from "@contracts/permissions";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/shared/i18n/i18n-provider";

type Props = {
  catalog: PermissionDefinition[];
  value: string[];
  onChange: (next: string[]) => void;
  readOnly: boolean;
};

const NONE = "none";

export function PermissionMatrix({ catalog, value, onChange, readOnly }: Props) {
  const { t } = useI18n();
  const resources = [...new Set(catalog.map((d) => d.resource))];
  const groups = [
    { id: "core" as const, items: resources.filter((r) => !isModule(catalog, r)) },
    { id: "patients" as const, items: resources.filter((r) => isModule(catalog, r)) },
  ].filter((g) => g.items.length > 0);

  function setScope(resource: PermissionResource, action: string, scope: string | null) {
    const prefix = `${action}:${resource}:`;
    const rest = value.filter((k) => !k.startsWith(prefix));
    onChange(scope ? [...rest, `${prefix}${scope}`] : rest);
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.id} className="overflow-x-auto rounded-md border">
          <h3 className="border-b bg-muted/50 px-3 py-2 text-sm font-semibold">
            {t(`roles.groups.${group.id}`)}
          </h3>
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="px-3 py-2 text-start font-medium">{t("roles.columns.resource")}</th>
                {actionSchema.options.map((action) => (
                  <th key={action} className="px-2 py-2 text-center font-medium">
                    {t(`roles.actions.${action}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.items.map((resource) => (
                <tr key={resource} className="border-b last:border-b-0">
                  <th scope="row" className="px-3 py-2 text-start font-medium">
                    {t(`roles.resources.${resource}`)}
                  </th>
                  {actionSchema.options.map((action) => {
                    const defs = catalog.filter(
                      (d) => d.resource === resource && d.action === action,
                    );
                    const label = `${t(`roles.actions.${action}`)} — ${t(`roles.resources.${resource}`)}`;
                    const current = defs.find((d) => value.includes(d.key))?.scope ?? null;
                    return (
                      <td key={action} className="px-2 py-2 text-center">
                        {defs.length === 0 ? (
                          <span aria-hidden className="text-muted-foreground">
                            —
                          </span>
                        ) : defs.length > 1 ? (
                          <Select
                            value={current ?? NONE}
                            disabled={readOnly}
                            onValueChange={(v) => setScope(resource, action, v === NONE ? null : v)}
                          >
                            <SelectTrigger className="h-8 w-full min-w-24" aria-label={label}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>{t("roles.scopes.none")}</SelectItem>
                              {defs.map((d) => (
                                <SelectItem key={d.scope} value={d.scope}>
                                  {t(`roles.scopes.${d.scope}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Checkbox
                            aria-label={label}
                            checked={current !== null}
                            disabled={readOnly}
                            onCheckedChange={(checked) =>
                              setScope(resource, action, checked === true ? "clinic" : null)
                            }
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function isModule(catalog: PermissionDefinition[], resource: PermissionResource): boolean {
  return catalog.some((d) => d.resource === resource && d.module !== null);
}
