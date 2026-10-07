import { describe, expect, it } from "vitest";
import { areaOfHost, areaOrigin } from "./area-host";

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
});
