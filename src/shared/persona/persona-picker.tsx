import { useState } from "react";
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
  const clinics = useQuery({
    queryKey: ["login-clinics"],
    queryFn: () => api.session.listLoginClinics(),
  });

  const needsClinic = kind !== "platform_admin";
  const effectiveClinic = clinicId ?? clinics.data?.[0]?.id ?? null;

  function apply() {
    const next = { kind, clinicId: needsClinic ? effectiveClinic : null };
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
              onClick={() => setKind(option)}
            >
              {t(`persona.${option}`)}
            </Button>
          ))}
        </div>
      </div>
      {needsClinic && (
        <div className="flex flex-col gap-2">
          <Label>{t("persona.clinic")}</Label>
          <Select value={effectiveClinic ?? ""} onValueChange={setClinicId}>
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
      <Button type="button" onClick={apply} disabled={needsClinic && !effectiveClinic}>
        {t("landing.enter")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("persona.demoNote")}</p>
    </div>
  );
}
