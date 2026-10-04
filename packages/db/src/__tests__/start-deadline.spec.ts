import { createServer, type Server } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../index.ts";
import { withStartDeadline } from "../start-deadline.ts";

/**
 * postgres.js 3.4.9 (porsager/postgres#1193): سيرفر بيقفل الـ socket بشكل نضيف وفيه query أولية
 * مستنية → الـ driver بيعيد الاتصال للأبد، والـ `connect_timeout` مابيوقفوش. السقف من ناحية JS
 * بيخلّي النداء يفشل في وقت محدود. (Codex على PR #22، P1.)
 */
describe("withStartDeadline", () => {
  it("fails a start that never comes, with no address in the message", async () => {
    const started = Date.now();
    const failure = await withStartDeadline(50, () => new Promise<never>(() => undefined)).catch(
      (error: unknown) => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/could not start a database transaction in time/);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("refuses a start that arrives after the caller was told it timed out", async () => {
    let lateStart: unknown;
    const failure = await withStartDeadline(20, async (began) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      try {
        began();
      } catch (error) {
        lateStart = error;
        throw error;
      }
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(String((lateStart as Error).message)).toMatch(/rolled back before any work/);
  });

  it("never cuts a transaction that started in time, however long it then runs", async () => {
    const result = await withStartDeadline(20, async (began) => {
      began();
      await new Promise((resolve) => setTimeout(resolve, 80));
      return "done";
    });
    expect(result).toBe("done");
  });
});

describe("a server that accepts and cleanly closes the socket (postgres.js#1193)", () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    port = typeof address === "object" && address !== null ? address.port : 0;
  });

  afterAll(() => {
    // Not awaited: close() waits for every socket, and the 3.4.9 driver keeps reconnecting — the
    // very loop #1193 describes (tracked as a follow-up driver patch).
    server.close();
    server.unref();
  });

  it("makes the wrapper and ping fail in bounded time instead of hanging", async () => {
    const db = createDatabase({
      url: `postgres://eyadex_app:not-a-real-secret@127.0.0.1:${port}/eyadex`,
      role: "eyadex_app",
      ids: { newId: () => "01920000-0000-7000-8000-000000000001" },
      connectTimeoutSeconds: 1,
      transactionTimeoutMs: 500,
    });
    const started = Date.now();
    const [tenant, ping] = await Promise.all([
      db.withNoTenant(async () => "ran").catch((error: unknown) => error as Error),
      db.ping().catch((error: unknown) => error as Error),
    ]);
    expect(Date.now() - started).toBeLessThan(5000);
    for (const failure of [tenant, ping]) {
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain("not-a-real-secret");
    }
    await db.close();
  }, 20_000);
});
