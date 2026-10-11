import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, CircleSlash, Edit3, Pill, Plus } from "lucide-react";
import { toast } from "sonner";
import type { Medicine } from "@eyadex/contracts/medicines";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { StatusPanel } from "@/shared/shell/status-panel";
import { MedicineDialog } from "./medicine-dialog";
import { medicalKeys, useClinicPersona, useMedicines, useRefreshMedical } from "./medical-queries";

/** The clinic medicines list: one table, row actions at the end, deactivate (never delete). */
export function MedicinesContent() {
  const api = useApi();
  const { persona } = useClinicPersona();
  const { session } = useSession();
  const { t } = useI18n();
  const refresh = useRefreshMedical();
  const list = useMedicines();
  const editable = can(session?.permissions ?? [], "update", "medicines");
  const [editing, setEditing] = useState<Medicine | null | "new">(null);
  const status = useMutation({
    mutationFn: (m: Medicine) =>
      m.status === "active"
        ? api.medical.deactivateMedicine(persona, m.id)
        : api.medical.reactivateMedicine(persona, m.id),
    onSuccess: (m) => {
      refresh(medicalKeys.medicines);
      toast.success(t(m.status === "active" ? "medicines.reactivated" : "medicines.deactivated"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  if (list.isLoading) return <LoadingBlock />;
  if (list.isError || !list.data) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("medicines.loadError")}
        body={t(`errors.${errorCodeOf(list.error)}`)}
      />
    );
  }
  const items = list.data.items;
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="me-auto text-sm text-muted-foreground">{t("medicines.subtitle")}</p>
        {editable && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("medicines.new")}
          </Button>
        )}
      </div>
      {!editable && (
        <p className="mb-3 text-xs text-muted-foreground">{t("medicines.readOnlyNote")}</p>
      )}
      {items.length === 0 ? (
        <StatusPanel icon={Pill} title={t("medicines.empty")} body={t("medicines.emptyBody")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="px-3 py-2 text-start font-medium">{t("medicines.columns.name")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("medicines.columns.dose")}</th>
                <th className="px-3 py-2 text-start font-medium">
                  {t("medicines.columns.frequency")}
                </th>
                <th className="px-3 py-2 text-start font-medium">
                  {t("medicines.columns.status")}
                </th>
                {editable && (
                  <th className="px-3 py-2 text-end font-medium">{t("common.actions")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-medium">{m.name}</td>
                  <td className="px-3 py-2">{m.defaultDose ?? "—"}</td>
                  <td className="px-3 py-2">{m.defaultFrequency ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 text-xs">
                      {m.status === "active" ? (
                        <CheckCircle2 className="size-3.5 text-primary" aria-hidden />
                      ) : (
                        <CircleSlash className="size-3.5 text-muted-foreground" aria-hidden />
                      )}
                      {t(m.status === "active" ? "common.active" : "common.inactive")}
                    </span>
                  </td>
                  {editable && (
                    <td className="px-3 py-2 text-end">
                      <div className="inline-flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                          <Edit3 className="size-4" />
                          {t("common.edit")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={status.isPending}
                          onClick={() => status.mutate(m)}
                        >
                          {t(
                            m.status === "active" ? "medicines.deactivate" : "medicines.reactivate",
                          )}
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MedicineDialog
        open={editing !== null}
        medicine={editing === "new" ? null : editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </section>
  );
}
