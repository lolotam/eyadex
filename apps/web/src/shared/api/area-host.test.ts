import { describe, expect, it } from "vitest";
import { areaHostsFrom, areaOfHost, areaOrigin } from "./area-host";

const at = (hostname: string, port = "") => ({ protocol: "https:", hostname, port });

describe("area hosts", () => {
  it("reads the area from the host name", () => {
    expect(areaOfHost("app.eyadex.com")).toBe("clinic");
    expect(areaOfHost("platform.eyadex.com")).toBe("platform");
    expect(areaOfHost("eyadex.com")).toBeNull();
  });
  it("links each area to its own host", () => {
    expect(areaOrigin("platform", at("app.eyadex.com"))).toBe("https://platform.eyadex.com");
    expect(areaOrigin("clinic", at("platform.eyadex.com"))).toBe("https://app.eyadex.com");
  });
  it("never builds a platform subdomain of a bare IP", () => {
    expect(areaOrigin("platform", at("127.0.0.1", "3000"))).toBe("https://platform.localhost:3000");
    expect(areaOrigin("clinic", at("127.0.0.1", "3000"))).toBe("https://127.0.0.1:3000");
  });
  it("NEGATIVE: the production default never takes a staging host for an area", () => {
    expect(areaOfHost("staging-app.eyadex.com")).toBeNull();
    expect(areaOfHost("staging-platform.eyadex.com")).toBeNull();
  });
});

describe("configured area hosts (ADR-0021)", () => {
  const staging = areaHostsFrom("staging-app.eyadex.com", "staging-platform.eyadex.com");

  it("maps exactly the configured hosts, case-insensitively", () => {
    expect(areaOfHost("staging-app.eyadex.com", staging)).toBe("clinic");
    expect(areaOfHost("STAGING-PLATFORM.eyadex.com", staging)).toBe("platform");
  });
  it("NEGATIVE: a staging build refuses production and local hosts", () => {
    for (const host of ["app.eyadex.com", "platform.eyadex.com", "eyadex.com", "localhost"]) {
      expect(areaOfHost(host, staging)).toBeNull();
    }
  });
  it("links each area to its configured host, keeping the scheme and port", () => {
    expect(areaOrigin("platform", at("staging-app.eyadex.com"), staging)).toBe(
      "https://staging-platform.eyadex.com",
    );
    expect(areaOrigin("clinic", at("staging-platform.eyadex.com", "8443"), staging)).toBe(
      "https://staging-app.eyadex.com:8443",
    );
  });
  it("leaves the production default in place when neither host is set", () => {
    expect(areaHostsFrom(undefined, undefined)).toBeNull();
    expect(areaHostsFrom("", "")).toBeNull();
  });
  it.each([
    ["staging-app.eyadex.com", undefined],
    [undefined, "staging-platform.eyadex.com"],
    ["same.eyadex.com", "SAME.eyadex.com"],
    ["https://staging-app.eyadex.com", "staging-platform.eyadex.com"],
    ["staging-app.eyadex.com:443", "staging-platform.eyadex.com"],
    ["staging app", "staging-platform.eyadex.com"],
  ])("NEGATIVE: refuses the pair %j / %j", (app, platform) => {
    expect(() => areaHostsFrom(app, platform)).toThrow(/VITE_APP_HOST|VITE_PLATFORM_HOST/);
  });
});
