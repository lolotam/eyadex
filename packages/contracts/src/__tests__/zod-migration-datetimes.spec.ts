import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { firstAdminInviteLinkSchema } from "../clinics.ts";
import { updateSubscriptionRequestSchema } from "../platform-clinics.ts";

// Installed zod@3.25.76 makes seconds optional and does not range-check offsets.
// These rows are the shapes a later RFC 3339 datetime() would drop. Outputs stay the input.

const EMAIL = "staff@example.test";

const UTC_ACCEPTED = [
  "2026-10-26T00:00Z",
  "2026-10-26T00:00:00Z",
  "2026-10-26T00:00:00.123Z",
  "2024-02-29T00:00Z",
] as const;

const UTC_REJECTED = [
  "2026-10-26T00:00:00+03:00",
  "2026-10-26T00:00:00+0300",
  "2026-02-29T00:00:00Z",
  "2026-13-01T00:00:00Z",
  "2026-04-31T00:00:00Z",
  "2026-10-26T24:00:00Z",
  "2016-12-31T23:59:60Z",
  "2026-10-26T00:00:00",
] as const;

const OFFSET_ACCEPTED = [
  "2026-10-26T00:00Z",
  "2026-10-26T00:00+03:00",
  "2026-10-26T00:00+0300",
  "2026-10-26T12:00:00+03:00",
  "2026-10-26T12:00:00+0300",
  "2026-10-26T12:00:00.5-0530",
  "2026-10-26T12:00:00+23:59",
  "2026-10-26T12:00:00+24:00",
  "2026-10-26T12:00:00+03:60",
  "2024-02-29T00:00+0300",
] as const;

const OFFSET_REJECTED = [
  "2026-02-29T00:00:00+00:00",
  "2026-13-01T00:00:00+0300",
  "2026-04-31T00:00+03:00",
  "2026-10-26T24:00:00+03:00",
  "2016-12-31T23:59:60Z",
  "2026-10-26T12:00:00",
] as const;

type Parsed = { success: true; data: unknown } | { success: false; error: z.ZodError };

function issues(result: Parsed): z.ZodIssue[] {
  expect(result.success).toBe(false);
  if (result.success) return [];
  return result.error.issues;
}

describe("firstAdminInviteLinkSchema datetime on Zod 3.25.76", () => {
  it.each(UTC_ACCEPTED)("accepts %s and returns that string", (expiresAt) => {
    expect(firstAdminInviteLinkSchema.parse({ email: EMAIL, token: null, expiresAt })).toEqual({
      email: EMAIL,
      token: null,
      expiresAt,
    });
  });

  it.each(UTC_REJECTED)("rejects %s on expiresAt", (expiresAt) => {
    expect(
      issues(firstAdminInviteLinkSchema.safeParse({ email: EMAIL, token: null, expiresAt })).map(
        (issue) => issue.path,
      ),
    ).toEqual([["expiresAt"]]);
  });

  it("strips an unknown key and does not invent a token", () => {
    expect(
      firstAdminInviteLinkSchema.parse({
        email: EMAIL,
        token: null,
        expiresAt: "2026-10-26T00:00Z",
        extra: "x",
      }),
    ).toEqual({ email: EMAIL, token: null, expiresAt: "2026-10-26T00:00Z" });
  });
});

describe("updateSubscriptionRequestSchema datetime on Zod 3.25.76", () => {
  it.each(OFFSET_ACCEPTED)("accepts %s and returns only that field", (expiresAt) => {
    expect(updateSubscriptionRequestSchema.parse({ expiresAt })).toEqual({ expiresAt });
  });

  it.each(OFFSET_REJECTED)("rejects %s on expiresAt", (expiresAt) => {
    expect(
      issues(updateSubscriptionRequestSchema.safeParse({ expiresAt })).map((issue) => issue.path),
    ).toEqual([["expiresAt"]]);
  });

  it("stays strict, requires one change, and does not invent an expiry", () => {
    expect(
      issues(
        updateSubscriptionRequestSchema.safeParse({
          expiresAt: "2026-10-26T00:00Z",
          extra: 1,
        }),
      ).map((issue) => ({ path: issue.path, code: issue.code })),
    ).toEqual([{ path: [], code: "unrecognized_keys" }]);
    expect(
      issues(updateSubscriptionRequestSchema.safeParse({})).map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    ).toEqual([{ path: [], code: "custom", message: "validation.required" }]);
    expect(
      issues(
        updateSubscriptionRequestSchema.safeParse({
          durationDays: 1,
          expiresAt: "2026-10-26T00:00Z",
        }),
      ).map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })),
    ).toEqual([{ path: ["expiresAt"], code: "custom", message: "validation.oneExpiry" }]);
    expect(updateSubscriptionRequestSchema.parse({ status: "trial" })).toEqual({
      status: "trial",
    });
    expect(updateSubscriptionRequestSchema.parse({ durationDays: 7 })).toEqual({
      durationDays: 7,
    });
  });
});
