import { describe, expect, it } from "vitest";
import { closeLifetime, newLifetime, track } from "../tx-lifetime.ts";

describe("bounded transaction tracking for long report cursors", () => {
  it("does not retain completed observed page statements", async () => {
    const lifetime = newLifetime();
    for (let page = 0; page < 10_000; page++)
      await track(lifetime.statements, Promise.resolve(page));
    expect(lifetime.statements.size).toBeLessThanOrEqual(1);
    expect(await closeLifetime(lifetime)).toBeUndefined();
  });
  it("still refuses a completed unobserved failure after many valid pages", async () => {
    const lifetime = newLifetime();
    void track(lifetime.statements, Promise.reject(new Error("sample failure")));
    for (let page = 0; page < 100; page++) await track(lifetime.statements, Promise.resolve(page));
    expect(await closeLifetime(lifetime)).toBe("unfinished-statement");
  });
});
