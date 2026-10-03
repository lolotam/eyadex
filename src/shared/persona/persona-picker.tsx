import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { personaKindSchema, type PersonaKind } from "@contracts/session";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "./persona-provider";

export function PersonaPicker({ onDone }: { onDone?: () => void }) {
  const api = useApi();
  const { t, pick } = useI18n();
  const { persona, setPersona } = usePersona();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [kind, setKind] = useState<PersonaKind>(persona.kind);
  const [clinicId, setClinicId] = useState<string | null>(persona.clinicId);
  const [memberId, setMemberId] = useState<string | null>(persona.memberId);
  const clinics = useQuery({
    queryKey: ["login-clinics"],
    queryFn: () => api.session.listLoginClinics(),
  });

  const needsClinic = kind !== "platform_admin";
  const effectiveClinic = clinicId ?? clinics.data?.[0]?.id ?? null;
  const accounts = useQuery({
    queryKey: ["login-accounts", effectiveClinic],
    queryFn: () => api.session.listLoginAccounts(effectiveClinic ?? ""),
    enabled: needsClinic && Boolean(effectiveClinic),
  });
  // A pinned account keeps its identity: if its role changed since the persona was saved,
  // follow the account's current role instead of silently choosing another person.
  const pinned = (accounts.data ?? []).find((a) => a.memberId === memberId);
  const pinnedKind: PersonaKind | null = pinned
    ? (personaKindSchema.safeParse(pinned.roleKey).data ?? "custom")
    : null;
  useEffect(() => {
    if (pinnedKind && pinnedKind !== kind) setKind(pinnedKind);
    // Only reconcile when the pinned account's role changes, not on every kind click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedKind]);

  // Accounts with a clinic-created role have no system key; they sign in under "custom".
  const kindAccounts = (accounts.data ?? []).filter((a) =>
    kind === "custom" ? a.roleKey === null : a.roleKey === kind,
  );
  const chosen =
    kindAccounts.find((a) => a.memberId === memberId) ??
    kindAccounts.find((a) => a.status === "active") ??
    kindAccounts[0];

  function apply() {
    const next = {
      kind,
      clinicId: needsClinic ? effectiveClinic : null,
      memberId: needsClinic ? (chosen?.memberId ?? null) : null,
    };
    setPersona(next);
    void queryClient.invalidateQueries({ queryKey: ["session"] });
    void navigate({ to: needsClinic ? "/clinic" : "/platform" });
    onDone?.();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>{t("persona.switch")}</Label>
        <div className="grid grid-cols-1 gap-1.5">
          {personaKindSchema.options.map((option) => (
            <Button
              key={option}
              type="button"
              variant={kind === option ? "default" : "outline"}
              className="justify-start"
              onClick={() => {
                setKind(option);
                setMemberId(null);
              }}
            >
              {t(`persona.${option}`)}
            </Button>
          ))}
        </div>
      </div>
      {needsClinic && (
        <div className="flex flex-col gap-2">
          <Label>{t("persona.clinic")}</Label>
          <Select
            value={effectiveClinic ?? ""}
            onValueChange={(value) => {
              setClinicId(value);
              setMemberId(null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("persona.chooseClinic")} />
            </SelectTrigger>
            <SelectContent>
              {clinics.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {pick(c.nameAr, c.nameEn)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {needsClinic && kindAccounts.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>{t("persona.account")}</Label>
          <Select value={chosen?.memberId ?? ""} onValueChange={setMemberId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kindAccounts.map((a) => (
                <SelectItem key={a.memberId} value={a.memberId}>
                  {a.fullName}
                  {kind === "custom" ? ` · ${pick(a.roleNameAr, a.roleNameEn)}` : ""}
                  {a.status === "deactivated" ? ` (${t("persona.deactivatedTag")})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {needsClinic && accounts.isSuccess && kindAccounts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t(kind === "custom" ? "persona.noCustomAccounts" : "persona.noAccountsForRole")}
        </p>
      )}
      <Button type="button" onClick={apply} disabled={needsClinic && (!effectiveClinic || !chosen)}>
        {t("landing.enter")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("persona.demoNote")}</p>
    </div>
  );
}
