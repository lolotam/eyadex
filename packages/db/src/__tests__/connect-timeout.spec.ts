import { describe, expect, it } from "vitest";

import { createDatabase } from "../index.ts";

/**
 * `10.255.255.1` محجوز (RFC 5737 TEST-NET-3) وبيبلع الـ packets: مفيش RST ولا ICMP، فـ
 * `connect()` بيفضل معلّق لحد ما `connect_timeout` في postgres.js يقفله. من غير الـ option ده
 * `ping` كان هيفضل مستني الـ TCP timeout الافتراضي (~سنتين على ويندوز) — فالاختبار بيقيس إن
 * الفشل جوه السقف اللي احنا حددناه، مش إنه فشل.
 */
const BLACK_HOLED = "postgres://eyadex_app:unused@10.255.255.1:5432/eyadex";
const REFUSED = "postgres://eyadex_app:unused@127.0.0.1:1/eyadex";

const newId = { newId: () => "01920000-0000-7000-8000-0000000000c1" };

describe("connectTimeoutSeconds bounds the connection setup", () => {
  it("ping rejects quickly instead of hanging on a host that swallows packets", async () => {
    const database = createDatabase({
      url: BLACK_HOLED,
      role: "eyadex_app",
      ids: newId,
      connectTimeoutSeconds: 1,
    });
    const started = Date.now();
    const failure = await database.ping().then(
      () => undefined,
      (error: unknown) => error,
    );
    const elapsed = Date.now() - started;
    expect(failure).toBeInstanceOf(Error);
    // سقف واسع عمداً: المقصود إن الـ driver هو اللي قفل، مش إننا سباقنا مع CI. من غير الـ
    // option كان هيفضل مستني الـ TCP timeout الافتراضي.
    expect(elapsed).toBeLessThan(3_000);
    await database.close();
  }, 15_000);

  it("a refused port still fails, and it is not reported as a DatabaseError", async () => {
    const database = createDatabase({
      url: REFUSED,
      role: "eyadex_app",
      ids: newId,
      connectTimeoutSeconds: 1,
    });
    await expect(database.ping()).rejects.toThrow();
    await database.close();
  }, 15_000);
});
