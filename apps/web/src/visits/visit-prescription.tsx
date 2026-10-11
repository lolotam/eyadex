import { useEffect, useId } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import {
  visitPrescriptionInputSchema,
  type PrescriptionItemInput,
  type VisitDetail,
} from "@eyadex/contracts/visits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMedicines } from "@/medical/medical-queries";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useVisitWrite } from "./use-visit-write";
import type { SectionSaves } from "./visit-section-saves";

type Items = NonNullable<VisitDetail["content"]>["prescription"];
type FormValues = { items: PrescriptionItemInput[] };
const FIELDS = ["dose", "frequency", "duration"] as const;

const toInput = (items: Items): PrescriptionItemInput[] =>
  items.map(({ position: _p, ...item }) => item);

/** Prescription items (P2-9): the medicine is picked from the clinic list or typed (P2-F2). */
export function VisitPrescription({
  visitId,
  items,
  editable,
  saves,
}: {
  visitId: string;
  items: Items;
  editable: boolean;
  saves?: SectionSaves;
}) {
  const { t } = useI18n();
  const { session } = useSession();
  const listId = useId();
  const medicines = useMedicines(editable && can(session?.permissions ?? [], "view", "medicines"));
  const active = (medicines.data?.items ?? []).filter((m) => m.status === "active");
  const form = useForm<FormValues>({
    resolver: zodResolver(visitPrescriptionInputSchema),
    defaultValues: { items: toInput(items) },
  });
  const rows = useFieldArray({ control: form.control, name: "items" });
  useEffect(() => form.reset({ items: toInput(items) }), [items, form]);
  const save = useVisitWrite<FormValues>(
    visitId,
    (api, persona, input) => api.savePrescription(persona, visitId, input),
    { success: "visit.prescriptionSaved", section: "prescription", saves },
  );

  function fillDefaults(index: number, name: string) {
    const known = active.find((m) => m.name === name);
    if (!known) return;
    if (!form.getValues(`items.${index}.dose`) && known.defaultDose)
      form.setValue(`items.${index}.dose`, known.defaultDose);
    if (!form.getValues(`items.${index}.frequency`) && known.defaultFrequency)
      form.setValue(`items.${index}.frequency`, known.defaultFrequency);
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-base font-semibold">{t("visit.prescription")}</h2>
      {!editable ? (
        items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("visit.noItems")}</p>
        ) : (
          <ul className="divide-y text-sm">
            {items.map((item) => (
              <li key={item.position} className="py-2">
                <p className="font-medium">{item.medicine}</p>
                <p className="text-muted-foreground">
                  {[item.dose, item.frequency, item.duration].filter(Boolean).join(" · ")}
                </p>
                {item.note && <p className="text-xs text-muted-foreground">{item.note}</p>}
              </li>
            ))}
          </ul>
        )
      ) : (
        <form className="flex flex-col gap-3" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <datalist id={listId}>
            {active.map((m) => (
              <option key={m.id} value={m.name} />
            ))}
          </datalist>
          {rows.fields.map((field, index) => (
            <div key={field.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
              <div className="flex gap-2 sm:col-span-2">
                <Input
                  list={listId}
                  aria-label={t("visit.item.medicine")}
                  placeholder={t("visit.item.medicine")}
                  maxLength={200}
                  {...form.register(`items.${index}.medicine`, {
                    onBlur: (e) => fillDefaults(index, e.target.value),
                  })}
                />
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
              {FIELDS.map((f) => (
                <Input
                  key={f}
                  aria-label={t(`visit.item.${f}`)}
                  placeholder={t(`visit.item.${f}`)}
                  maxLength={100}
                  {...form.register(`items.${index}.${f}`)}
                />
              ))}
              <Input
                aria-label={t("visit.item.note")}
                placeholder={t("visit.item.note")}
                maxLength={300}
                {...form.register(`items.${index}.note`, {
                  setValueAs: (v: string) => (v === "" ? null : v),
                })}
              />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={rows.fields.length >= 30}
              onClick={() =>
                rows.append({ medicine: "", dose: "", frequency: "", duration: "", note: null })
              }
            >
              <Plus className="size-4" />
              {t("visit.addItem")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t("visit.savePrescription")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
