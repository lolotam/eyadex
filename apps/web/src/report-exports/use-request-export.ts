import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import {
  reportExportRequestSchema,
  type ReportExport,
  type ReportExportRequest,
} from "@eyadex/contracts/finance-reports";
import { reportPermissionScope } from "@eyadex/contracts/finance-report-access";
import { useApi } from "@/shared/api/api-provider";
import { errorKeyOf } from "@/shared/api/api-error";
import { usePersona, useSession } from "@/shared/persona/persona-provider";

/** One schema issue: the field path and the schema's own `validation.*` key, or null for a shape issue. */
export type ExportRequestIssue = { path: string; message: string | null };
export type RequestExportOutcome =
  | { status: "queued"; export: ReportExport }
  | { status: "invalid"; issues: ExportRequestIssue[] }
  | { status: "ineligible" }
  | { status: "duplicate" }
  | { status: "stale" }
  | { status: "failed"; error: string };
type Attempt = { epoch: number };
type Published =
  | { epoch: number; kind: "queued"; export: ReportExport }
  | { epoch: number; kind: "invalid"; issues: ExportRequestIssue[] }
  | { epoch: number; kind: "failed"; error: string };

/**
 * Queues one export for the current requester on explicit submit. The lock is a ref, so two calls
 * in the same tick send one POST; the adapter stays the authority on access and the queue.
 */
export function useRequestExport() {
  const api = useApi();
  const client = useQueryClient();
  const { persona, ready } = usePersona();
  const { session, isLoading, error: sessionError } = useSession();
  const coherent =
    ready &&
    !isLoading &&
    !sessionError &&
    !!session?.membershipId &&
    !!session.clinic &&
    session.clinic.id === persona.clinicId &&
    session.persona.kind === persona.kind &&
    session.persona.memberId === persona.memberId;
  const open = coherent && session.blocked === null && session.features.finance === true;
  const history = [
    "clinic",
    "report-exports",
    persona.kind,
    persona.clinicId,
    persona.memberId,
    session?.clinic?.id,
    session?.membershipId,
  ] as const;
  const scope = JSON.stringify([
    ...history,
    [...(session?.permissions ?? [])].sort().join(" "),
    session?.allBranches ?? null,
    [...(session?.branchIds ?? [])].sort().join(" "),
    session?.blocked ?? null,
    session?.features.finance ?? null,
    open,
  ]);
  const identity = useRef(scope);
  const generation = useRef(0);
  if (identity.current !== scope) generation.current += 1;
  identity.current = scope;
  const epoch = generation.current;
  const mounted = useRef(false);
  const lock = useRef<Attempt | null>(null);
  const [pending, setPending] = useState<Attempt | null>(null);
  const [published, setPublished] = useState<Published | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = useCallback(
    async (input: z.input<typeof reportExportRequestSchema>): Promise<RequestExportOutcome> => {
      const current = () => mounted.current && generation.current === epoch;
      if (!current()) return { status: "stale" };
      if (lock.current?.epoch === epoch) return { status: "duplicate" };
      const parsed = reportExportRequestSchema.safeParse(input);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message.startsWith("validation.") ? i.message : null,
        }));
        setPublished({ epoch, kind: "invalid", issues });
        return { status: "invalid", issues };
      }
      const body: ReportExportRequest = parsed.data;
      if (!open || !session || reportPermissionScope(session.permissions, body.report) === null)
        return { status: "ineligible" };
      const attempt: Attempt = { epoch };
      lock.current = attempt;
      setPending(attempt);
      setPublished(null);
      try {
        const queued = await api.reports.requestExport(persona, body);
        if (!current()) return { status: "stale" };
        setPublished({ epoch, kind: "queued", export: queued.export });
        await client.invalidateQueries({
          predicate: (q) =>
            q.queryKey.length === history.length + 1 &&
            history.every((part, index) => q.queryKey[index] === part),
        });
        if (!current()) return { status: "stale" };
        return { status: "queued", export: queued.export };
      } catch (error) {
        if (!current()) return { status: "stale" };
        const code = errorKeyOf(error);
        setPublished({ epoch, kind: "failed", error: code });
        return { status: "failed", error: code };
      } finally {
        if (lock.current === attempt) lock.current = null;
        if (mounted.current) setPending((p) => (p === attempt ? null : p));
      }
    },
    // `history` is derived from the same inputs as `scope`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, client, persona, session, open, epoch, scope],
  );

  const mine = published?.epoch === epoch ? published : null;
  return {
    submit,
    isEligibleFor: (report: ReportExportRequest["report"]) =>
      open && !!session && reportPermissionScope(session.permissions, report) !== null,
    isPending: pending?.epoch === epoch,
    queued: mine?.kind === "queued" ? mine.export : null,
    issues: mine?.kind === "invalid" ? mine.issues : [],
    error: sessionError ? errorKeyOf(sessionError) : mine?.kind === "failed" ? mine.error : null,
  };
}
