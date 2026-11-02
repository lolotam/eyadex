import { randomBytes } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { asDatabaseError } from "./database-error.ts";
import { renderOnce, sendRendered, type RawTx } from "./single-render.ts";
import { assertStatementAllowed } from "./statement-guard.ts";
import { assertLive, track, type Lifetime } from "./tx-lifetime.ts";

/** A non-holdable, read-only server cursor. It expires with its tenant transaction/savepoint. */
export interface TenantCursor<TRow> {
  /** Reads at most 500 rows from the SELECT's single PostgreSQL snapshot. */
  read(): Promise<TRow[]>;
  /** Releases the cursor early. Commit and rollback always close it as well. */
  close(): Promise<void>;
}

/** Private bridge: the public handle exposes neither SQL commands nor the underlying driver. */
export function openTenantCursor<TRow>(
  raw: RawTx,
  lifetime: Lifetime,
  query: SQL,
): Promise<TenantCursor<TRow>> {
  const command = <T>(text: string, params: readonly unknown[] = []) =>
    track(
      lifetime.statements,
      (async () => {
        assertLive(lifetime);
        try {
          return await sendRendered<T>(raw, { text, params });
        } catch (error) {
          throw asDatabaseError(error);
        }
      })(),
    );
  return track(
    lifetime.statements,
    (async () => {
      assertLive(lifetime);
      const rendered = renderOnce(raw, query);
      assertStatementAllowed(rendered.text);
      // No writes, settings, holdable cursors or user-supplied cursor control can be smuggled here.
      if (!/^\s*SELECT\b/i.test(rendered.text))
        throw new TypeError("tenant cursor requires SELECT");
      // Conservative raw-text guard, like assertStatementAllowed: comments and quoted text cannot
      // hide a lock. Bound parameters are separate, so their contents never trigger this check.
      if (/\bFOR\b[\s\S]*?\b(?:UPDATE|SHARE)\b/i.test(rendered.text))
        throw new TypeError("tenant cursor refuses row-locking SELECT");
      const name = `eyadex_cursor_${randomBytes(12).toString("hex")}`;
      await command(`DECLARE "${name}" NO SCROLL CURSOR FOR ${rendered.text}`, rendered.params);
      let closed = false;
      let reading = false;
      const close = async (): Promise<void> => {
        if (closed) return;
        if (reading) throw new TypeError("tenant cursor is busy");
        closed = true;
        lifetime.resources.delete(close);
        try {
          // Internal cleanup runs after revocation, before COMMIT or RELEASE SAVEPOINT.
          await sendRendered(raw, { text: `CLOSE "${name}"`, params: [] });
        } catch (error) {
          throw asDatabaseError(error);
        }
      };
      lifetime.resources.add(close);
      return Object.freeze({
        read: (): Promise<TRow[]> => {
          assertLive(lifetime);
          if (closed || reading)
            return Promise.reject(new TypeError("tenant cursor is closed or busy"));
          reading = true;
          return track(
            lifetime.statements,
            command<TRow>(`FETCH FORWARD 500 FROM "${name}"`)
              .catch((error: unknown) => {
                // PostgreSQL must roll back after a failed FETCH; CLOSE would mask it with 25P02.
                closed = true;
                lifetime.resources.delete(close);
                throw error;
              })
              .finally(() => {
                reading = false;
              }),
          );
        },
        close: (): Promise<void> =>
          track(
            lifetime.statements,
            (async () => {
              assertLive(lifetime);
              await close();
            })(),
          ),
      });
    })(),
  );
}
