import { describe, expect, it } from "vitest";

import { AUTH_LIMITS, rateRulesFor } from "../auth-rate-limits.ts";
import { AUTH_ROUTES } from "../auth-routes.ts";
import { RateLimiter, type CounterStore, type RateRule } from "../rate-limiter.ts";

// The same fixed-window semantics as the Redis script, on a clock the test moves by hand.
class FakeStore implements CounterStore {
  now = 0;
  readonly keys = new Map<string, { count: number; expiresAt: number }>();
  async increment(key: string, windowMs: number) {
    const entry = this.keys.get(key);
    if (entry === undefined || entry.expiresAt <= this.now) {
      this.keys.set(key, { count: 1, expiresAt: this.now + windowMs });
      return { count: 1, ttlMs: windowMs };
    }
    entry.count += 1;
    return { count: entry.count, ttlMs: entry.expiresAt - this.now };
  }
}

const rule = (value: string): RateRule => ({
  route: "sign-in-email",
  dimension: "email",
  value,
  limit: { max: 3, windowMs: 60_000 },
});

describe("RateLimiter", () => {
  it("allows up to the limit, then refuses with the seconds left in the window", async () => {
    const store = new FakeStore();
    const limiter = new RateLimiter(store, "s".repeat(32));
    for (let i = 0; i < 3; i++)
      expect((await limiter.check("clinic", [rule("a")])).allowed).toBe(true);
    store.now = 20_500;
    expect(await limiter.check("clinic", [rule("a")])).toEqual({
      allowed: false,
      retryAfterSeconds: 40,
    });
  });

  it("starts a fresh window once the old one ends", async () => {
    const store = new FakeStore();
    const limiter = new RateLimiter(store, "s".repeat(32));
    for (let i = 0; i < 4; i++) await limiter.check("clinic", [rule("a")]);
    store.now = 60_000;
    expect((await limiter.check("clinic", [rule("a")])).allowed).toBe(true);
  });

  it("refuses when any one dimension is over, and keeps areas apart", async () => {
    const store = new FakeStore();
    const limiter = new RateLimiter(store, "s".repeat(32));
    for (let i = 0; i < 3; i++) await limiter.check("clinic", [rule("a")]);
    expect((await limiter.check("clinic", [rule("b"), rule("a")])).allowed).toBe(false);
    expect((await limiter.check("platform", [rule("a")])).allowed).toBe(true);
  });

  it("keys carry an HMAC of the value, never the value", () => {
    const limiter = new RateLimiter(new FakeStore(), "s".repeat(32));
    const key = limiter.key("clinic", rule("someone@example.com"));
    expect(key).toMatch(/^eyadex:rl:clinic:sign-in-email:email:[0-9a-f]{64}$/);
    expect(key).not.toContain("someone");
  });
});

describe("RateLimiter short-circuit", () => {
  it("NEGATIVE: a request refused on its IP never creates a key for its email", async () => {
    const store = new FakeStore();
    const limiter = new RateLimiter(store, "s".repeat(32));
    const ip = {
      route: "sign-in-email",
      dimension: "ip",
      value: "192.0.2.9",
      limit: { max: 1, windowMs: 60_000 },
    };
    await limiter.check("clinic", [ip, rule("first@example.com")]);
    const before = store.keys.size;
    for (let i = 0; i < 50; i++) {
      expect((await limiter.check("clinic", [ip, rule(`spray-${i}@example.com`)])).allowed).toBe(
        false,
      );
    }
    expect(store.keys.size).toBe(before);
  });
});

describe("rateRulesFor", () => {
  it("NEGATIVE: every password-checking route shares one bucket for the user", async () => {
    const store = new FakeStore();
    const limiter = new RateLimiter(store, "s".repeat(32));
    const paths = [
      "/change-password",
      "/two-factor/enable",
      "/two-factor/disable",
      "/two-factor/generate-backup-codes",
    ];
    const decisions = [];
    for (let i = 0; i < AUTH_LIMITS.sensitivePerUser.max + 1; i++) {
      const rules = rateRulesFor({
        area: "clinic",
        path: paths[i % paths.length]!,
        ip: "192.0.2.1",
        body: "",
        cookieHeader: undefined,
        userId: "u1",
      });
      decisions.push((await limiter.check("clinic", rules)).allowed);
    }
    expect(decisions.at(-1)).toBe(false);
  });

  const base = {
    area: "clinic" as const,
    ip: "192.0.2.1",
    cookieHeader: undefined,
    userId: undefined,
  };

  it("sign-in counts the IP and the normalised email", () => {
    const rules = rateRulesFor({
      ...base,
      path: "/sign-in/email",
      body: JSON.stringify({ email: "  A@Example.COM " }),
    });
    expect(rules.map((r) => [r.dimension, r.value, r.limit])).toEqual([
      ["ip", "192.0.2.1", AUTH_LIMITS.signInPerIp],
      ["email", "a@example.com", AUTH_LIMITS.signInPerEmail],
    ]);
  });

  it("second factor counts the user, else the pending two_factor cookie", () => {
    const withUser = rateRulesFor({
      ...base,
      path: "/two-factor/verify-totp",
      body: "",
      userId: "u1",
    });
    expect(withUser[1]?.value).toBe("user:u1");
    const pending = rateRulesFor({
      ...base,
      path: "/two-factor/verify-backup-code",
      body: "",
      cookieHeader: "x=1; __Secure-eyadex-clinic.two_factor=abc",
    });
    expect(pending[1]?.value).toBe("pending:abc");
    expect(pending[1]?.limit).toBe(AUTH_LIMITS.secondFactorPerSubject);
  });

  it("change-password and enable count the user; unlimited routes count nothing", () => {
    expect(
      rateRulesFor({ ...base, path: "/change-password", body: "", userId: "u1" })[0]?.limit,
    ).toBe(AUTH_LIMITS.sensitivePerUser);
    expect(rateRulesFor({ ...base, path: "/get-session", body: "" })).toEqual([]);
  });

  it("an untrusted client address shares one bucket", () => {
    const rules = rateRulesFor({ ...base, ip: undefined, path: "/sign-in/email", body: "" });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.value).toBe("untrusted");
  });
});

describe("every exposed POST that takes a secret is limited", () => {
  // Sign-out takes no password, code or email; everything else on the allowlist must count somewhere.
  const UNLIMITED = new Set(["/sign-out"]);
  for (const route of AUTH_ROUTES.filter((r) => r.method === "POST" && !UNLIMITED.has(r.path))) {
    it(`${route.path} has at least one counter`, () => {
      const rules = rateRulesFor({
        area: "clinic",
        path: route.path,
        ip: "203.0.113.7",
        body: JSON.stringify({ email: "someone@example.com" }),
        cookieHeader: undefined,
        userId: "00000000-0000-7000-8000-000000000001",
      });
      expect(rules.length).toBeGreaterThan(0);
    });
  }
});
