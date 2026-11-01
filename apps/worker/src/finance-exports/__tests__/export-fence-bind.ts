import type { Database, DispatcherOutbox } from "@eyadex/db";

import type { PgExportStore } from "../persistence/pg-export-store.ts";

export interface FenceContext {
  readonly app: Database;
  readonly store: PgExportStore;
  readonly outbox: DispatcherOutbox;
}

let current: FenceContext | undefined;

export function bindFence(context: FenceContext): void {
  current = context;
}

export function fence(): FenceContext {
  if (current === undefined) throw new Error("fence context is not bound");
  return current;
}
