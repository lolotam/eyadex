import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";

export type EventHandler = (event: ClaimedEvent) => Promise<DispatchOutcome>;

/** ما يحتاجه الـ poller: الأنواع اللي يطلبها بالظبط، والدالة اللي توزّع عليها. */
export interface EventRoute {
  readonly types: readonly string[];
  readonly handle: EventHandler;
}

/**
 * يبني توزيع نوع → handler لـ poller واحد. الأنواع اللي بيتعمل ليها claim هي مفاتيح الخريطة بس، فنوع
 * من غير handler عمره ما يتمسك ويفضل في الـ outbox لـ slice تانية.
 *
 * @param handlers خريطة النوع → الـ handler
 * @returns الأنواع والدالة الموزّعة
 */
export function routeEvents(handlers: Readonly<Record<string, EventHandler>>): EventRoute {
  const table = new Map(Object.entries(handlers));
  return {
    types: [...table.keys()],
    handle: (event) => {
      const handler = table.get(event.type);
      // Unreachable: the claim filters on `types`. Failing closed beats guessing.
      if (handler === undefined) return Promise.resolve({ kind: "failed", error: "unrouted" });
      return handler(event);
    },
  };
}
