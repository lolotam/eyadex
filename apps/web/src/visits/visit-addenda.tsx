import { useState } from "react";
import { Plus } from "lucide-react";
import type { VisitDetail } from "@eyadex/contracts/visits";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useVisitWrite } from "./use-visit-write";

type Addenda = NonNullable<VisitDetail["content"]>["addenda"];

/** Addenda (P2-6): who, when, text; added only on a signed visit by its provider. */
export function VisitAddenda({
  visitId,
  addenda,
  canAdd,
}: {
  visitId: string;
  addenda: Addenda;
  canAdd: boolean;
}) {
  const { t, formatDate } = useI18n();
  const [writing, setWriting] = useState(false);
  const [body, setBody] = useState("");
  const add = useVisitWrite<{ body: string }>(
    visitId,
    (api, persona, input) => api.addAddendum(persona, visitId, input),
    {
      success: "visit.addendumAdded",
      onDone: () => {
        setBody("");
        setWriting(false);
      },
    },
  );
  if (addenda.length === 0 && !canAdd) return null;
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t("visit.addenda")}</h2>
        {canAdd && !writing && (
          <Button variant="outline" onClick={() => setWriting(true)}>
            <Plus className="size-4" />
            {t("visit.addAddendum")}
          </Button>
        )}
      </div>
      {addenda.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("visit.noAddenda")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {addenda.map((x) => (
            <li key={x.id} className="border-s-2 border-primary/40 ps-3">
              <p className="whitespace-pre-wrap text-sm">{x.body}</p>
              <p className="text-xs text-muted-foreground">
                {t("visit.by", { name: x.authorName, date: formatDate(x.createdAt) })}
              </p>
            </li>
          ))}
        </ul>
      )}
      {writing && (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate({ body });
          }}
        >
          <Textarea
            aria-label={t("visit.addendumBody")}
            rows={3}
            maxLength={8000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={add.isPending || !body.trim()}>
              {t("visit.addAddendum")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setWriting(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
