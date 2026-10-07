import { describe, expect, it } from "vitest";
import { comingSoonActionFor, isUnservedPath } from "./unserved-paths";

describe("unserved paths", () => {
  it("keeps clinic creation reachable from the gated platform home and clinic list", () => {
    for (const path of ["/platform", "/platform/", "/platform/clinics", "/platform/clinics/"]) {
      expect(isUnservedPath(path)).toBe(true);
      expect(comingSoonActionFor(path)).toBe("createClinic");
    }
  });
  it("serves the creation page itself and offers no action elsewhere", () => {
    expect(isUnservedPath("/platform/clinics/new")).toBe(false);
    expect(comingSoonActionFor("/platform/team")).toBeNull();
    expect(comingSoonActionFor("/clinic/patients")).toBeNull();
  });
});
