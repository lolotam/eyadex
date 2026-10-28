import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReportExport } from "@eyadex/contracts/finance-reports";
import { useApi } from "@/shared/api/api-provider";
import { errorKeyOf } from "@/shared/api/api-error";
import { usePersona, useSession } from "@/shared/persona/persona-provider";

type History = { items: ReportExport[]; nextCursor: string | null; total: number };
const newest = (a: ReportExport, b: ReportExport) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
const merge = (old: ReportExport[], fresh: ReportExport[]) =>
  [...new Map([...old, ...fresh].map((row) => [row.id, row])).values()].sort(newest);

/** Requester metadata survives report-key loss; only the adapter decides access. */
export function useExportHistory() {
  const api = useApi();
  const client = useQueryClient();
  const { persona, ready } = usePersona();
  const { session, isLoading, error: sessionError } = useSession();
  const key = [
    "clinic",
    "report-exports",
    persona.kind,
    persona.clinicId,
    persona.memberId,
    session?.clinic?.id,
    session?.membershipId,
  ] as const;
  const scope = JSON.stringify(key);
  const identity = useRef(scope);
  const generation = useRef(0);
  if (identity.current !== scope) generation.current += 1;
  identity.current = scope;
  const epoch = generation.current;
  const cacheKey = [...key, epoch] as const;
  const mounted = useRef(false);
  const pending = useRef<{ scope: string; epoch: number; work: Promise<void> } | null>(null);
  const enabled =
    ready &&
    !isLoading &&
    !sessionError &&
    !!session?.membershipId &&
    session.clinic?.id === persona.clinicId &&
    session.persona.kind === persona.kind &&
    session.persona.memberId === persona.memberId;
  const current = () =>
    mounted.current && identity.current === scope && generation.current === epoch;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const query = useQuery({
    queryKey: cacheKey,
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }): Promise<History> => {
      if (pending.current?.scope === scope && pending.current.epoch === epoch)
        await pending.current.work;
      if (signal.aborted || !current()) throw new Error("Cancelled export history");
      const previous = client.getQueryData<History>(cacheKey);
      const head = await api.reports.listExports(persona, {});
      if (signal.aborted || !current()) throw new Error("Cancelled export history");
      // Keep loaded tails when newly queued jobs shift the head. Refresh their real metadata,
      // rather than replacing server cursors with a client-generated offset.
      const ids = new Set(head.items.map((row) => row.id));
      const tail = await Promise.all(
        (previous?.items ?? [])
          .filter((row) => !ids.has(row.id))
          .map(async (row) => (await api.reports.getExport(persona, row.id)).export),
      );
      if (signal.aborted || !current()) throw new Error("Cancelled export history");
      return {
        items: merge(tail, head.items),
        total: head.total,
        nextCursor: tail.length > 0 && previous ? previous.nextCursor : head.nextCursor,
      };
    },
    refetchInterval: (q) =>
      !q.state.error &&
      !client.getQueryData([...cacheKey, "page-error"]) &&
      q.state.data?.items.some((row) => row.status === "queued" || row.status === "running")
        ? 2000
        : false,
    refetchIntervalInBackground: false,
  });

  async function loadMore() {
    if (!enabled || query.isFetching || !query.data?.nextCursor) return;
    if (pending.current?.scope === scope && pending.current.epoch === epoch)
      return pending.current.work;
    const cursor = query.data.nextCursor;
    const work = (async () => {
      try {
        const page = await api.reports.listExports(persona, { cursor });
        if (!current()) return;
        client.setQueryData<History>(cacheKey, (old) => ({
          items: merge(old?.items ?? [], page.items),
          nextCursor: page.nextCursor,
          total: page.total,
        }));
        client.setQueryData([...cacheKey, "page-error"], null);
      } catch (error) {
        if (current()) client.setQueryData([...cacheKey, "page-error"], errorKeyOf(error));
      }
    })();
    pending.current = { scope, epoch, work };
    client.setQueryData([...cacheKey, "page-pending"], true);
    try {
      await work;
    } finally {
      if (pending.current?.work === work) pending.current = null;
      if (current()) client.setQueryData([...cacheKey, "page-pending"], false);
    }
  }
  const pageError = useQuery<string | null>({
    queryKey: [...cacheKey, "page-error"],
    queryFn: () => null,
    enabled: false,
  });
  const pagePending = useQuery<boolean>({
    queryKey: [...cacheKey, "page-pending"],
    queryFn: () => false,
    enabled: false,
  });
  return {
    items: enabled ? (query.data?.items ?? []) : [],
    total: enabled ? (query.data?.total ?? 0) : 0,
    hasMore: enabled && !!query.data?.nextCursor,
    isLoading: isLoading || (enabled && query.isPending),
    isRefreshing: enabled && query.isFetching,
    isLoadingMore: enabled && !!pagePending.data,
    error: sessionError ? errorKeyOf(sessionError) : query.error ? errorKeyOf(query.error) : null,
    pageError: enabled ? (pageError.data ?? null) : null,
    loadMore,
    refresh: () => query.refetch({ cancelRefetch: false }),
    retry: () => query.refetch({ cancelRefetch: false }),
  };
}
