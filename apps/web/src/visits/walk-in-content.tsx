import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, Search, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import type { WalkInCandidates } from "@eyadex/contracts/visits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { StatusPanel } from "@/shared/shell/status-panel";
import { useClinicPersona, useWalkInBranches } from "./medical-queries";

/** Walk-in (P2-2): branch → search by name or file number (POST body) → pick → start → the visit. */
export function WalkInContent() {
  const api = useApi();
  const { persona } = useClinicPersona();
  const { t, pick } = useI18n();
  const navigate = useNavigate();
  const branches = useWalkInBranches();
  const [branchId, setBranchId] = useState("");
  const [q, setQ] = useState("");
  const [result, setResult] = useState<WalkInCandidates | null>(null);
  // One key per patient per page opening: a retried start replays instead of opening a second visit.
  const keys = useRef(new Map<string, string>());
  const keyFor = (patientId: string) => {
    const known = keys.current.get(patientId) ?? crypto.randomUUID();
    keys.current.set(patientId, known);
    return known;
  };
  const first = branches.data?.items[0]?.id;
  useEffect(() => {
    if (!branchId && first) setBranchId(first);
  }, [branchId, first]);

  const find = useMutation({
    mutationFn: () => api.medical.walkInCandidates(persona, { branchId, q: q.trim() }),
    onSuccess: setResult,
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  const start = useMutation({
    mutationFn: (patientId: string) =>
      api.medical.startVisit(persona, { patientId, branchId }, keyFor(patientId)),
    onSuccess: (detail) => {
      toast.success(t("visits.started"));
      void navigate({ to: "/clinic/visits/$visitId", params: { visitId: detail.visit.id } });
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  if (branches.isLoading) return <LoadingBlock />;
  if (branches.isError) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("visits.loadError")}
        body={t(`errors.${errorCodeOf(branches.error)}`)}
      />
    );
  }
  const options = branches.data?.items ?? [];
  if (options.length === 0) {
    return <StatusPanel icon={Stethoscope} title={t("visits.noBranches")} body="" />;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (branchId && q.trim().length >= 2) find.mutate();
  }

  return (
    <section className="max-w-2xl rounded-lg border bg-card p-4">
      <h2 className="text-base font-semibold">{t("visits.walkInTitle")}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t("visits.walkInBody")}</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="walk-in-branch">{t("visits.branch")}</Label>
          <Select
            value={branchId}
            onValueChange={(v) => {
              setBranchId(v);
              setResult(null);
            }}
          >
            <SelectTrigger id="walk-in-branch" aria-label={t("visits.branch")}>
              <SelectValue placeholder={t("visits.chooseBranch")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {pick(b.nameAr, b.nameEn)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="walk-in-search">{t("visits.search")}</Label>
          <div className="flex gap-2">
            <Input
              id="walk-in-search"
              value={q}
              maxLength={60}
              onChange={(e) => setQ(e.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={find.isPending || q.trim().length < 2}
              aria-label={t("common.search")}
            >
              <Search className="size-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("visits.searchHint")}</p>
        </div>
      </form>
      {result && (
        <div className="mt-4">
          {result.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("visits.noCandidates")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {result.items.map((c) => (
                <li key={c.patientId} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <div className="min-w-40 flex-1">
                    <p className="font-medium">{c.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("visits.fileNumber", { fileNumber: String(c.fileNumber) })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={start.isPending}
                    onClick={() => start.mutate(c.patientId)}
                  >
                    <Stethoscope className="size-4" />
                    {t("visits.start")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
