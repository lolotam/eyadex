import { describe, expect, it } from "vitest";
import { comingSoonActionFor, isUnservedPath } from "./unserved-paths";

describe("unserved paths", () => {
  it("keeps clinic creation reachable from the gated platform home", () => {
    for (const path of ["/platform", "/platform/"]) {
      expect(isUnservedPath(path)).toBe(true);
      expect(comingSoonActionFor(path)).toBe("createClinic");
    }
  });
  it("serves the clinic list and the creation page, and offers no action elsewhere", () => {
    expect(isUnservedPath("/platform/clinics")).toBe(false);
    expect(isUnservedPath("/platform/clinics/")).toBe(false);
    expect(isUnservedPath("/platform/clinics/new")).toBe(false);
    expect(comingSoonActionFor("/platform/clinics")).toBeNull();
    expect(comingSoonActionFor("/platform/team")).toBeNull();
    expect(comingSoonActionFor("/clinic/patients")).toBeNull();
  });
});
