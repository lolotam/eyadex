import { describe, expect, it } from "vitest";
import { roleWriteAccess } from "./role-write-access";

const ALL = ["create:roles:clinic", "update:roles:clinic", "deactivate:roles:clinic"];

describe("roleWriteAccess", () => {
  it("follows the permissions, in every API mode (slice 8 serves the writes)", () => {
    expect(roleWriteAccess(ALL)).toEqual({ mayCreate: true, mayUpdate: true, mayDeactivate: true });
    expect(roleWriteAccess(["view:roles:clinic", "update:roles:clinic"])).toEqual({
      mayCreate: false,
      mayUpdate: true,
      mayDeactivate: false,
    });
    expect(roleWriteAccess([])).toEqual({
      mayCreate: false,
      mayUpdate: false,
      mayDeactivate: false,
    });
  });
});
