import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReportExport } from "@eyadex/contracts/finance-reports";
import { useApi } from "@/shared/api/api-provider";
import { errorKeyOf } from "@/shared/api/api-error";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { useCommittedEpoch } from "./use-committed-epoch";

type DownloadState = {
  scope: string;
  /** Keyed by token, not row id: an older request's `finally` must never clear a newer request of the same row. */
  pending: Map<string, { row: string; access: number }>;
  unavailable: Set<string>;
  errors: Record<string, string>;
};

/** Browser delivery only: permissions, bytes and expiry remain the adapter's responsibility. */
export function useExportDownload(rows: readonly ReportExport[], refresh: () => unknown) {
  const api = useApi();
  const { persona, ready } = usePersona();
  const { session, isLoading, error } = useSession();
  const scope = JSON.stringify([
    persona.kind,
    persona.clinicId,
    persona.memberId,
    session?.clinic?.id,
    session?.membershipId,
  ]);
  // A denial is a fact about the access it met; when permissions, reach or module state change, the
  // adapter is asked again instead of trusting a mark from older access.
  const access = JSON.stringify([
    [...(session?.permissions ?? [])].sort(),
    session?.allBranches ?? null,
    [...(session?.branchIds ?? [])].sort(),
    session?.blocked ?? null,
    session?.features.finance ?? null,
  ]);
  // Both generations advance on commit only, and the live snapshot below is written in a layout
  // effect: a speculative render React abandons (another persona, a not-ready session) changes none.
  const { epoch, isCurrent: isCurrentScope } = useCommittedEpoch(scope);
  // A counter, not the fingerprint: access that goes A -> B -> A is a new generation, so a request
  // made under the first A can neither be returned to a retry nor apply its late answer.
  const { epoch: accessEpoch, isCurrent: isCurrentAccess } = useCommittedEpoch(access);
  const snapshot = {
    scope,
    rows,
    ready:
      ready &&
      !isLoading &&
      !error &&
      !!session?.membershipId &&
      session.clinic?.id === persona.clinicId &&
      session.persona.kind === persona.kind &&
      session.persona.memberId === persona.memberId,
  };
  // Initialised from the first render, so a download right after mount already sees it.
  const live = useRef(snapshot);
  useLayoutEffect(() => {
    live.current = snapshot;
  });
  const mounted = useRef(false);
  const inFlight = useRef(new Map<string, Promise<void>>());
  const unavailable = useRef(new Map<string, Set<string>>());
  const [state, setState] = useState<DownloadState>({
    scope,
    pending: new Map(),
    unavailable: new Set(),
    errors: {},
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    unavailable.current.clear();
    setState({ scope, pending: new Map(), unavailable: new Set(), errors: {} });
  }, [scope]);
  const seenAccess = useRef(accessEpoch);
  useEffect(() => {
    if (seenAccess.current === accessEpoch) return;
    seenAccess.current = accessEpoch;
    unavailable.current.clear();
    setState((old) => {
      const errors = Object.fromEntries(
        Object.entries(old.errors).filter(
          ([, code]) => code !== "forbidden" && code !== "not_found",
        ),
      );
      // An older access's requests can no longer block or report; only this access's stay.
      const pending = new Map([...old.pending].filter(([, entry]) => entry.access === accessEpoch));
      return { ...old, pending, unavailable: new Set(), errors };
    });
  }, [accessEpoch]);
  const current = () =>
    mounted.current && live.current.scope === scope && isCurrentScope(epoch) && live.current.ready;
  function update(change: (old: DownloadState) => DownloadState) {
    if (current())
      setState((old) =>
        change(
          old.scope === scope
            ? old
            : {
                scope,
                pending: new Map(),
                unavailable: new Set(),
                errors: {},
              },
        ),
      );
  }
  function canDownload(row: ReportExport) {
    return (
      live.current.ready && row.status === "done" && !unavailable.current.get(scope)?.has(row.id)
    );
  }
  function download(row: ReportExport): Promise<void> {
    // The access generation is part of the key: a request made under older access can neither block
    // a retry under the current access nor apply its late answer to it.
    const started = accessEpoch;
    const token = JSON.stringify([scope, epoch, started, row.id]);
    const sameAccess = () => current() && isCurrentAccess(started);
    const prior = inFlight.current.get(token);
    if (prior) return prior;
    if (
      !current() ||
      !canDownload(row) ||
      !live.current.rows.some(
        (item) => item.id === row.id && item.status === "done" && item.format === row.format,
      )
    )
      return Promise.resolve();
    update((old) => ({
      ...old,
      pending: new Map(old.pending).set(token, { row: row.id, access: started }),
      errors: Object.fromEntries(Object.entries(old.errors).filter(([id]) => id !== row.id)),
    }));
    const work = (async () => {
      try {
        const blob = await api.reports.downloadExport(persona, row.id);
        // The identity and visible DTO must still belong to this mounted consumer after bytes arrive.
        if (
          !sameAccess() ||
          !live.current.rows.some(
            (item) => item.id === row.id && item.status === "done" && item.format === row.format,
          ) ||
          !canDownload(row)
        )
          return;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        try {
          anchor.href = url;
          anchor.download = `finance-report-${row.id}.${row.format}`;
          document.body.appendChild(anchor);
          anchor.click();
        } finally {
          anchor.remove();
          URL.revokeObjectURL(url);
        }
      } catch (failure) {
        if (!sameAccess()) return;
        const code = errorKeyOf(failure);
        if (code === "forbidden" || code === "not_found") {
          const denied = unavailable.current.get(scope) ?? new Set<string>();
          denied.add(row.id);
          unavailable.current.set(scope, denied);
          update((old) => ({
            ...old,
            unavailable: new Set(denied),
            errors: { ...old.errors, [row.id]: code },
          }));
          // A refreshed DTO may remain done after permission loss; never invent a terminal status.
          try {
            await api.reports.getExport(persona, row.id);
          } catch {
            /* Still unavailable. */
          }
          if (current()) {
            try {
              await refresh();
            } catch {
              /* Manual history retry owns this error. */
            }
          }
        } else update((old) => ({ ...old, errors: { ...old.errors, [row.id]: code } }));
      } finally {
        inFlight.current.delete(token);
        update((old) => {
          const pending = new Map(old.pending);
          pending.delete(token);
          return { ...old, pending };
        });
      }
    })();
    inFlight.current.set(token, work);
    return work;
  }
  const own = state.scope === scope;
  const pending = new Set<string>(
    own
      ? [...state.pending.values()].filter((e) => e.access === accessEpoch).map((e) => e.row)
      : [],
  );
  return {
    pending,
    unavailable: own ? state.unavailable : new Set<string>(),
    errors: own ? state.errors : {},
    canDownload,
    download,
  };
}
