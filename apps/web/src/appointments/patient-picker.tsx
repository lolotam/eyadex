import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, UserPlus } from "lucide-react";
import { formatFileNumber } from "@eyadex/contracts/patients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { QuickFileForm } from "./quick-file-form";

export type PickedPatient = { id: string; label: string };

type Props = {
  value: PickedPatient | null;
  branchId: string;
  error?: string | undefined;
  onChange: (patient: PickedPatient | null) => void;
};

/** Rule 7: an active file found by the patients search (view:patients), or a quick new file (D-10). */
export function PatientPicker({ value, branchId, error, onChange }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { session } = useSession();
  const { t, tDynamic } = useI18n();
  const permissions = session?.permissions ?? [];
  const maySearch = can(permissions, "view", "patients");
  const mayCreate = can(permissions, "create", "patients");
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);
  const q = term.trim();
  const results = useQuery({
    queryKey: ["clinic", "appointments", "patient-search", q, persona.clinicId, persona.memberId],
    queryFn: () =>
      api.patients.list(persona, { cursor: null, limit: 6, q, branchId: null, status: "active" }),
    enabled: maySearch && q.length >= 2 && value === null,
  });

  if (value !== null) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <span className="truncate text-sm font-medium">{value.label}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          {t("appointments.patientPicker.change")}
        </Button>
      </div>
    );
  }
  if (creating) {
    return (
      <QuickFileForm
        branchId={branchId}
        onCreated={(patient) => {
          setCreating(false);
          onChange(patient);
        }}
        onBack={() => setCreating(false)}
      />
    );
  }
  const items = results.data?.items ?? [];
  return (
    <div className="grid gap-2">
      {maySearch ? (
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="ps-8"
            value={term}
            aria-label={t("appointments.patientPicker.search")}
            placeholder={t("appointments.patientPicker.search")}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("appointments.patientPicker.cannotSearch")}
        </p>
      )}
      {maySearch && q.length < 2 && (
        <p className="text-xs text-muted-foreground">
          {t("appointments.patientPicker.searchHint")}
        </p>
      )}
      {q.length >= 2 && results.isError && (
        <div className="flex items-center gap-2 text-xs">
          <span role="alert" className="text-destructive">
            {t("appointments.patientPicker.searchFailed")}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => results.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {q.length >= 2 && !results.isLoading && !results.isError && items.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("appointments.patientPicker.noResults")}</p>
      )}
      {items.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-muted"
                onClick={() =>
                  onChange({ id: p.id, label: `${p.fullName} · ${formatFileNumber(p.fileNumber)}` })
                }
              >
                <span className="truncate">{p.fullName}</span>
                <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">
                  {formatFileNumber(p.fileNumber)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {mayCreate && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => setCreating(true)}
        >
          <UserPlus className="size-4" />
          {t("appointments.patientPicker.newFile")}
        </Button>
      )}
      {error && <p className="text-[0.8rem] font-medium text-destructive">{tDynamic(error)}</p>}
    </div>
  );
}
