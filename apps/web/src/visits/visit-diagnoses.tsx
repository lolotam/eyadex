import { useMemo } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import {
  visitDiagnosesInputSchema,
  type DiagnosisInput,
  type VisitDetail,
} from "@eyadex/contracts/visits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { Icd10Picker } from "./icd10-picker";
import { useServerItems } from "./use-server-items";
import { useVisitWrite } from "./use-visit-write";
import type { SectionSaves } from "./visit-section-saves";

type Diagnoses = NonNullable<VisitDetail["content"]>["diagnoses"];
type FormValues = { items: DiagnosisInput[] };

const toInput = (rows: Diagnoses): DiagnosisInput[] =>
  rows.map((d) =>
    d.kind === "icd10" && d.code
      ? { kind: "icd10", code: d.code, text: d.text }
      : { kind: "text", text: d.text },
  );

const diagnosisFields = (d: DiagnosisInput) => [d.kind, d.kind === "icd10" ? d.code : null, d.text];

/** Diagnoses (P2-8): per row a switch between an ICD-10-CM code and free text. */
export function VisitDiagnoses({
  visitId,
  diagnoses,
  editable,
  saves,
}: {
  visitId: string;
  diagnoses: Diagnoses;
  editable: boolean;
  saves?: SectionSaves;
}) {
  const { t } = useI18n();
  const server = useMemo(() => toInput(diagnoses), [diagnoses]);
  const form = useForm<FormValues>({
    resolver: zodResolver(visitDiagnosesInputSchema),
    defaultValues: { items: server },
  });
  const rows = useFieldArray({ control: form.control, name: "items" });
  useServerItems(form, server, diagnosisFields);
  const save = useVisitWrite<FormValues>(
    visitId,
    (api, persona, input) => api.saveDiagnoses(persona, visitId, input),
    { success: "visit.diagnosesSaved", section: "diagnoses", saves },
  );
  const values = form.watch("items");

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-base font-semibold">{t("visit.diagnoses")}</h2>
      {!editable ? (
        diagnoses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("visit.noDiagnoses")}</p>
        ) : (
          <ol className="list-inside list-decimal space-y-1 text-sm">
            {diagnoses.map((d) => (
              <li key={d.position}>
                {d.code ? (
                  <span dir="ltr">
                    <span className="font-medium">{d.code}</span> — {d.text}
                  </span>
                ) : (
                  d.text
                )}
              </li>
            ))}
          </ol>
        )
      ) : (
        <form className="flex flex-col gap-3" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          {rows.fields.map((field, index) => {
            const row = values[index];
            const icd = row?.kind === "icd10";
            return (
              <div key={field.id} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id={`dx-kind-${index}`}
                    checked={icd}
                    aria-label={t("visit.kindLabel")}
                    onCheckedChange={(checked) =>
                      form.setValue(
                        `items.${index}`,
                        checked
                          ? { kind: "icd10", code: "", text: "" }
                          : { kind: "text", text: row?.text ?? "" },
                      )
                    }
                  />
                  <Label htmlFor={`dx-kind-${index}`} className="me-auto text-sm">
                    {icd ? t("visit.kindIcd10") : t("visit.kindText")}
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("visit.remove")}
                    onClick={() => rows.remove(index)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {icd && row?.kind === "icd10" ? (
                  <Icd10Picker
                    code={row.code}
                    title={row.text}
                    onPick={(pick) =>
                      form.setValue(`items.${index}`, {
                        kind: "icd10",
                        code: pick.code,
                        text: pick.title,
                      })
                    }
                  />
                ) : (
                  <Input
                    aria-label={t("visit.diagnosisText")}
                    maxLength={500}
                    {...form.register(`items.${index}.text`)}
                  />
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={rows.fields.length >= 20}
              onClick={() => rows.append({ kind: "text", text: "" })}
            >
              <Plus className="size-4" />
              {t("visit.addDiagnosis")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t("visit.saveDiagnoses")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
