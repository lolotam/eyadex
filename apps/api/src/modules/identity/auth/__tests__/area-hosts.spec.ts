import { describe, expect, it } from "vitest";

import { AreaHosts as Hosts } from "../area-hosts.ts";

describe("AreaHosts.clientIp", () => {
  const hosts = (trustProxyHops: number) =>
    new Hosts({
      appUrl: "https://app.eyadex.test",
      platformUrl: "https://platform.eyadex.test",
      trustProxyHops,
    });

  it("uses the socket and ignores a client-sent X-Forwarded-For when no proxy is trusted", () => {
    expect(hosts(0).clientIp({ "x-forwarded-for": "6.6.6.6" }, "10.0.0.9")).toBe("10.0.0.9");
  });

  it("takes the address our outermost proxy appended, not what the client prepended", () => {
    const headers = { "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" };
    expect(hosts(2).clientIp(headers, "10.0.0.3")).toBe("203.0.113.7");
    expect(hosts(1).clientIp(headers, "10.0.0.3")).toBe("10.0.0.2");
  });

  it("trusts nothing when the chain is shorter than the configured hops", () => {
    expect(hosts(2).clientIp({ "x-forwarded-for": "203.0.113.7" }, "10.0.0.3")).toBeUndefined();
  });
});

import { AreaHosts } from "../area-hosts.ts";
import { findAuthRoute } from "../auth-routes.ts";

const hosts = (trustProxyHops = 0) =>
  new AreaHosts({
    appUrl: "https://app.eyadex.test",
    platformUrl: "https://platform.eyadex.test:8443",
    trustProxyHops,
  });

describe("host → area", () => {
  it("matches the exact host, case-insensitively", () => {
    expect(hosts().resolve({ host: "app.eyadex.test" })).toBe("clinic");
    expect(hosts().resolve({ host: "APP.Eyadex.TEST" })).toBe("clinic");
    expect(hosts().resolve({ host: "platform.eyadex.test:8443" })).toBe("platform");
  });

  it("is port-aware: the default port is the bare host, any other port is a different host", () => {
    expect(hosts().resolve({ host: "app.eyadex.test:443" })).toBe("clinic");
    expect(hosts().resolve({ host: "app.eyadex.test:8443" })).toBeNull();
    expect(hosts().resolve({ host: "platform.eyadex.test" })).toBeNull();
  });

  it("refuses unknown hosts, suffixes and junk", () => {
    for (const host of [
      "api.eyadex.test",
      "evil-app.eyadex.test",
      "app.eyadex.test.evil",
      "x@app.eyadex.test",
      "app.eyadex.test/x",
      "",
    ]) {
      expect(hosts().resolve({ host })).toBeNull();
    }
    expect(hosts().resolve({})).toBeNull();
  });

  it("ignores X-Forwarded-Host by default", () => {
    expect(
      hosts().resolve({ host: "localhost:3001", "x-forwarded-host": "app.eyadex.test" }),
    ).toBeNull();
    expect(
      hosts().resolve({ host: "app.eyadex.test", "x-forwarded-host": "platform.eyadex.test:8443" }),
    ).toBe("clinic");
  });

  it("with TRUST_PROXY_HOPS reads the entry our proxy appended, not the client's", () => {
    const one = hosts(1);
    expect(one.resolve({ host: "api:3001", "x-forwarded-host": "app.eyadex.test" })).toBe("clinic");
    expect(
      one.resolve({ host: "api:3001", "x-forwarded-host": "app.eyadex.test, evil.test" }),
    ).toBeNull();
    expect(one.resolve({ host: "app.eyadex.test" })).toBeNull();
  });

  it("refuses identical hosts at startup", () => {
    expect(
      () =>
        new AreaHosts({
          appUrl: "https://a.test",
          platformUrl: "https://A.test/",
          trustProxyHops: 0,
        }),
    ).toThrow(/distinct/);
  });
});

describe("auth route allowlist", () => {
  it("exposes only the listed routes, exactly", () => {
    expect(findAuthRoute("POST", "/sign-in/email")).toBeDefined();
    expect(findAuthRoute("GET", "/sign-in/email")).toBeUndefined();
    for (const path of [
      "/sign-up/email",
      "/delete-user",
      "/update-user",
      "/list-sessions",
      "/sign-in/email/",
      "/sign-in/%65mail",
    ]) {
      expect(findAuthRoute("POST", path)).toBeUndefined();
    }
  });
});
