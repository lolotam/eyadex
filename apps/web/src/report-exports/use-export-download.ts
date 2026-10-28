import { useEffect, useRef, useState } from "react";
import type { ReportExport } from "@eyadex/contracts/finance-reports";
import { useApi } from "@/shared/api/api-provider";
import { errorKeyOf } from "@/shared/api/api-error";
import { usePersona, useSession } from "@/shared/persona/persona-provider";

type DownloadState = {
  scope: string;
  pending: Set<string>;
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
  const live = useRef({ scope, rows, ready: false });
  live.current = {
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
  const mounted = useRef(false);
  const inFlight = useRef(new Map<string, Promise<void>>());
  const unavailable = useRef(new Map<string, Set<string>>());
  const [state, setState] = useState<DownloadState>({
    scope,
    pending: new Set(),
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
    setState({ scope, pending: new Set(), unavailable: new Set(), errors: {} });
  }, [scope]);
  const current = () => mounted.current && live.current.scope === scope && live.current.ready;
  function update(change: (old: DownloadState) => DownloadState) {
    if (current())
      setState((old) =>
        change(
          old.scope === scope
            ? old
            : {
                scope,
                pending: new Set(),
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
    const token = JSON.stringify([scope, row.id]);
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
      pending: new Set(old.pending).add(row.id),
      errors: Object.fromEntries(Object.entries(old.errors).filter(([id]) => id !== row.id)),
    }));
    const work = (async () => {
      try {
        const blob = await api.reports.downloadExport(persona, row.id);
        // The identity and visible DTO must still belong to this mounted consumer after bytes arrive.
        if (
          !current() ||
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
        if (!current()) return;
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
          const pending = new Set(old.pending);
          pending.delete(row.id);
          return { ...old, pending };
        });
      }
    })();
    inFlight.current.set(token, work);
    return work;
  }
  const visible =
    state.scope === scope
      ? state
      : { pending: new Set<string>(), unavailable: new Set<string>(), errors: {} };
  return { ...visible, canDownload, download };
}
