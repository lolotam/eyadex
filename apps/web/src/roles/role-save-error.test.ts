import { describe, expect, it } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { roleSaveError } from "./role-save-error";

const NARROW = ["view:payments:branch", "create:payments:clinic"];
const shownCore = new Set(["view:users:clinic", "update:users:clinic"]);

// PR #98: the form sends the keys it does not show, so a hidden broken pair is named by its module.
describe("the message of a failed role save", () => {
  it("names the module when the request was refused for a hidden pair", () => {
    const failure = roleSaveError(
      new ApiError("validation"),
      ["view:users:clinic", ...NARROW],
      shownCore,
    );
    expect(failure).toMatchObject({ code: "role_hidden_keys_invalid", module: "finance" });
  });

  it("keeps the server's module when it sent one", () => {
    const failure = roleSaveError(
      new ApiError("role_hidden_keys_invalid", undefined, { module: "finance" }),
      [],
      shownCore,
    );
    expect(failure).toMatchObject({ code: "role_hidden_keys_invalid", module: "finance" });
  });

  // MergePilot on PR #98: only the view rule is relabelled; a legacy role breaking another rule is not.
  it("leaves a legacy role holding two scopes for one action as plain validation", () => {
    const twoScopes = ["view:users:clinic", "view:patients:clinic", "view:patients:branch"];
    const failure = roleSaveError(new ApiError("validation"), [...twoScopes, ...NARROW], shownCore);
    expect(failure).toEqual({ code: "validation", details: {} });
  });

  it("leaves a stored unknown key as plain validation", () => {
    const failure = roleSaveError(
      new ApiError("validation"),
      ["view:users:clinic", "delete:everything:clinic", ...NARROW],
      shownCore,
    );
    expect(failure.code).toBe("validation");
  });

  it("leaves a refusal of the shown keys as it is", () => {
    const failure = roleSaveError(new ApiError("validation"), ["update:users:clinic"], shownCore);
    expect(failure).toEqual({ code: "validation", details: {} });
  });

  it("leaves any other error as it is", () => {
    const failure = roleSaveError(new ApiError("role_name_taken"), NARROW, shownCore);
    expect(failure.code).toBe("role_name_taken");
    expect(failure.module).toBeUndefined();
  });
});
