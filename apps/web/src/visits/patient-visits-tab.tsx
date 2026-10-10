import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Plus, Search, Stethoscope, X } from "lucide-react";
import type { VisitSummary } from "@eyadex/contracts/visits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApi } from "@/shared/api/api-provider";
import { useClinicPersona, usePatientVisits } from "@/medical/medical-queries";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { StatusPanel } from "@/shared/shell/status-panel";
import { VisitStatusBadge } from "./visit-status-badge";

/**
 * The file's visits, newest first; the preview only with `view:medical:*`. The note search posts its
 * query in the body (`searchVisits`), never in a URL (P2-F4).
 */
export function PatientVisitsTab({ patientId }: { patientId: string }) {
  const api = useApi();
  const { persona, enabled, personaKey } = useClinicPersona();
  const { t, formatDate } = useI18n();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const list = usePatientVisits(patientId, cursor);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const search = useQuery({
    // The query text stays out of the cache key: one search at a time, dropped on leaving.
    queryKey: ["clinic", "medical", "visit-search", patientId, run, ...personaKey],
    queryFn: () => api.medical.searchVisits(persona, patientId, { q: query ?? "" }),
    enabled: enabled && query !== null,
    gcTime: 0,
    retry: false,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    setQuery(q.length > 0 ? q : null);
    setRun((n) => n + 1);
  }

  if (list.isLoading) return <LoadingBlock />;
  if (list.isError || !list.data) {
    return (
      <StatusPanel icon={AlertCircle} title={t("visits.loadError")} body={t("errors.unknown")} />
    );
  }
  const rows: VisitSummary[] = query !== null ? (search.data?.items ?? []) : list.data.items;
  const can = list.data.can;
  return (
    <section className="max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="me-auto text-base font-semibold">{t("visits.list")}</h2>
        {can.start && (
          <Button variant="outline" asChild>
            <Link to="/clinic/visits">
              <Plus className="size-4" />
              {t("visits.newWalkIn")}
            </Link>
          </Button>
        )}
      </div>
      {can.search && (
        <form onSubmit={submit} className="mb-3 flex gap-2" role="search">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("visits.searchNotes")}
            aria-label={t("visits.searchNotes")}
            maxLength={100}
          />
          <Button type="submit" variant="outline" aria-label={t("common.search")}>
            <Search className="size-4" />
          </Button>
          {query !== null && (
            <Button
              type="button"
              variant="ghost"
              aria-label={t("visits.searchClear")}
              onClick={() => {
                setDraft("");
                setQuery(null);
              }}
            >
              <X className="size-4" />
            </Button>
          )}
        </form>
      )}
      {query !== null && search.isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <StatusPanel
          icon={Stethoscope}
          title={query !== null ? t("visits.noMatches") : t("visits.empty")}
          body={query !== null ? "" : t("visits.emptyBody")}
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
              <div className="min-w-40 flex-1">
                <Link
                  to="/clinic/visits/$visitId"
                  params={{ visitId: v.id }}
                  className="font-medium text-primary hover:underline"
                >
                  {formatDate(v.startedAt)}
                </Link>
                <p className="text-xs text-muted-foreground">{v.providerName}</p>
                {v.preview !== null && (
                  <p className="mt-1 line-clamp-2 text-muted-foreground">
                    {v.preview || t("visits.noPreview")}
                  </p>
                )}
              </div>
              <VisitStatusBadge status={v.status} />
            </li>
          ))}
        </ul>
      )}
      {query === null && (
        <div className="mt-3 flex gap-2">
          {cursors.length > 1 && (
            <Button variant="outline" size="sm" onClick={() => setCursors((c) => c.slice(0, -1))}>
              {t("common.previous")}
            </Button>
          )}
          {list.data.nextCursor && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCursors((c) => [...c, list.data.nextCursor ?? undefined])}
            >
              {t("common.next")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
