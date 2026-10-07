import { describe, expect, it } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { signOutOfApi } from "./sign-out";

const failing = (error: unknown) => ({ signOut: () => Promise.reject(error) });

describe("signOutOfApi", () => {
  it("is signed out when the API ends the session", async () => {
    expect(await signOutOfApi({ signOut: () => Promise.resolve() })).toBe(true);
  });
  it("is signed out when the session had already ended (401)", async () => {
    expect(await signOutOfApi(failing(new ApiError("unauthorized")))).toBe(true);
  });
  it("is still signed in when the request failed for another reason", async () => {
    expect(await signOutOfApi(failing(new ApiError("unknown")))).toBe(false);
    expect(await signOutOfApi(failing(new TypeError("network")))).toBe(false);
  });
});
