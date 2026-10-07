import { describe, expect, it } from "vitest";
import { roleWriteAccess } from "./role-write-access";

const ALL = ["create:roles:clinic", "update:roles:clinic", "deactivate:roles:clinic"];
const NONE = { mayCreate: false, mayUpdate: false, mayDeactivate: false };

describe("roleWriteAccess", () => {
  it("follows the permissions against the mock", () => {
    expect(roleWriteAccess(ALL, "mock")).toEqual({
      mayCreate: true,
      mayUpdate: true,
      mayDeactivate: true,
    });
    expect(roleWriteAccess([], "mock")).toEqual(NONE);
  });
  it("offers no role write against the API until slice 8 serves it", () => {
    expect(roleWriteAccess(ALL, "http")).toEqual(NONE);
  });
});
