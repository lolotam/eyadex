import { useCallback, useEffect, useRef, useState } from "react";
import type {
  reportOutstandingQuerySchema,
  reportOutstandingResponseSchema,
} from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { errorKeyOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { useCommittedEpoch } from "../use-committed-epoch";
import { canOpenReport } from "./report-catalogue";

export type OutstandingQuery = z.output<typeof reportOutstandingQuerySchema>;
export type OutstandingPage = z.output<typeof reportOutstandingResponseSchema>;
/** The filters the pager is given: the pager alone owns the cursor and the page size. */
export type OutstandingFilters = Omit<OutstandingQuery, "cursor" | "limit">;

export const OUTSTANDING_PAGE_SIZE = 50;

type State = {
  key: string;
  pages: OutstandingPage[];
  firstError: string | null;
  moreError: string | null;
  loadingMore: boolean;
};

const blank = (key: string): State => ({
  key,
  pages: [],
  firstError: null,
  moreError: null,
  loadingMore: false,
});

/**
 * R5 page by page. The scope key carries the actor, the membership, the sorted permissions, the
 * reach and the parsed filters; a change starts again at page 1 and drops the pages shown. A page
 * answered under an older key or committed epoch is ignored. Everything returned is derived from
 * this render's state, never from a ref.
 */
export function useOutstandingPages(filters: OutstandingFilters | null) {
  const api = useApi();
  const { persona } = usePersona();
  const { session } = useSession();
  const enabled =
    filters !== null &&
    !!session &&
    session.blocked === null &&
    session.features.finance === true &&
    canOpenReport(session.permissions, "outstanding");
  const key = JSON.stringify([
    persona.kind,
    persona.clinicId,
    persona.memberId,
    session?.membershipId ?? null,
    [...(session?.permissions ?? [])].sort(),
    session?.allBranches ?? null,
    [...(session?.branchIds ?? [])].sort(),
    enabled ? { from: filters.from, to: filters.to, branchId: filters.branchId ?? null } : null,
  ]);
  const { epoch, isCurrent } = useCommittedEpoch(key);
  const [state, setState] = useState<State>(() => blank(key));
  // Held by event handlers and effects only, never read while rendering.
  const busy = useRef<string | null>(null);

  const fetchPage = useCallback(
    (cursor: string | undefined, forKey: string, forEpoch: number) => {
      if (!filters) return;
      const query: OutstandingQuery = {
        ...filters,
        limit: OUTSTANDING_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      };
      busy.current = forKey;
      api.reports.outstanding(persona, query).then(
        (page) => {
          if (!isCurrent(forEpoch)) return;
          busy.current = null;
          // The first page replaces the list; a later page is appended only when it answers the
          // cursor the list is waiting for, so a repeated answer can never duplicate rows.
          setState((old) => {
            if (old.key !== forKey) return old;
            if (cursor && (old.pages.at(-1)?.nextCursor || null) !== cursor) return old;
            return {
              ...old,
              pages: cursor ? [...old.pages, page] : [page],
              loadingMore: false,
              moreError: null,
            };
          });
        },
        (error: unknown) => {
          if (!isCurrent(forEpoch)) return;
          busy.current = null;
          const code = errorKeyOf(error);
          setState((old) =>
            old.key !== forKey
              ? old
              : cursor
                ? { ...old, loadingMore: false, moreError: code }
                : { ...old, firstError: code },
          );
        },
      );
    },
    [api, persona, filters, isCurrent],
  );

  useEffect(() => {
    setState((old) => (old.key === key ? old : blank(key)));
    busy.current = null;
    if (enabled) fetchPage(undefined, key, epoch);
    // The key holds every input of the request; `fetchPage` changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const current = state.key === key ? state : blank(key);
  const last = current.pages.at(-1);
  // An empty cursor is no cursor: `hasMore` and `loadMore` read the same value.
  const nextCursor = last?.nextCursor || null;

  const loadMore = () => {
    if (!enabled || !nextCursor || busy.current === key) return;
    setState((old) => (old.key === key ? { ...old, loadingMore: true, moreError: null } : old));
    fetchPage(nextCursor, key, epoch);
  };
  const retry = () => {
    if (!enabled || busy.current === key) return;
    setState(blank(key));
    fetchPage(undefined, key, epoch);
  };

  const first = current.pages[0];
  return {
    rows: enabled ? current.pages.flatMap((p) => p.items) : [],
    total: first?.total ?? 0,
    summary: first?.summary ?? [],
    currency: first?.currency ?? null,
    exponent: first?.currencyExponent ?? 0,
    isLoading: enabled && !first && current.firstError === null,
    error: enabled ? current.firstError : null,
    moreError: enabled ? current.moreError : null,
    loadingMore: enabled && current.loadingMore,
    hasMore: enabled && nextCursor !== null,
    loadMore,
    retry,
    retryMore: loadMore,
  };
}
