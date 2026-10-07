import { describe, expect, it } from "vitest";
import { meResponseSchema } from "@eyadex/contracts/access";
import { contextFromMe } from "../http-session";
import { me } from "./fetch-stub";

describe("contextFromMe", () => {
  it("never blocks a clinic the API let through, whatever the device clock says", () => {
    const pastOnThisDevice = meResponseSchema.parse({
      ...me,
      clinic: { ...me.clinic, expiresAt: "2000-01-01T00:00:00.000Z" },
    });
    expect(contextFromMe(pastOnThisDevice).blocked).toBeNull();
  });
});
