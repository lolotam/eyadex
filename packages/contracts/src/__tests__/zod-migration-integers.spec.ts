import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { maxUsersSchema, subscriptionInputSchema } from "../clinics.ts";
import {
  platformClinicFinanceRequestSchema,
  type PlatformClinicFinanceRequest,
} from "../finance.ts";
import { platformOverviewSchema } from "../platform.ts";
import { weekdaySchema } from "../schedules.ts";
import { userListHttpQuerySchema } from "../user-admin.ts";
import { parseMailProviderTest } from "../../../../apps/worker/src/mail-provider-test/domain/test-event.ts";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const ABOVE_SAFE = MAX_SAFE + 1;
const HUGE = 1e20;
const CLINIC = "00000000-0000-0000-0000-000000000001";

type Parsed = { success: true; data: unknown } | { success: false; error: z.ZodError };

function issues(result: Parsed): { path: PropertyKey[]; code: string; message: string }[] {
  expect(result.success).toBe(false);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path,
    code: issue.code,
    message: issue.message,
  }));
}

const counts = platformOverviewSchema.shape.counts;
const tax = platformClinicFinanceRequestSchema;

describe("legacy integer acceptance", () => {
  it("keeps an unbounded count and a worker provider version that are not safe integers", () => {
    expect(counts.parse({ trial: HUGE, expired: ABOVE_SAFE })).toEqual({
      trial: HUGE,
      expired: ABOVE_SAFE,
    });
    expect(counts.parse({ active: 0 })).toEqual({ active: 0 });
    expect(
      parseMailProviderTest(
        {
          clinicId: CLINIC,
          providerId: CLINIC,
          providerVersion: HUGE,
          actorUserId: CLINIC,
        },
        CLINIC,
      ),
    ).toEqual({
      clinicId: CLINIC,
      providerId: CLINIC,
      slot: "primary",
      providerVersion: HUGE,
      actorUserId: CLINIC,
    });
  });

  it("rejects a fractional provider version and keeps a safe integer", () => {
    expect(
      parseMailProviderTest(
        {
          clinicId: CLINIC,
          providerId: CLINIC,
          providerVersion: 1.5,
          actorUserId: CLINIC,
        },
        CLINIC,
      ),
    ).toBeNull();
    expect(
      parseMailProviderTest(
        {
          clinicId: CLINIC,
          providerId: CLINIC,
          providerVersion: ABOVE_SAFE,
          actorUserId: CLINIC,
        },
        CLINIC,
      )?.providerVersion,
    ).toBe(ABOVE_SAFE);
  });
});

describe("bounded tax rate issue maps", () => {
  it("accepts the bounds and returns the number", () => {
    expect(tax.parse({ taxRateBp: 0 })).toEqual({ taxRateBp: 0 });
    expect(tax.parse({ taxRateBp: 10000 })).toEqual({ taxRateBp: 10000 });
  });

  it("keeps the integer issue and the range issue for a fraction outside the bound", () => {
    expect(issues(tax.safeParse({ taxRateBp: 1.5 }))).toEqual([
      { path: ["taxRateBp"], code: "invalid_type", message: "validation.number" },
    ]);
    expect(issues(tax.safeParse({ taxRateBp: -0.5 }))).toEqual([
      { path: ["taxRateBp"], code: "invalid_type", message: "validation.number" },
      { path: ["taxRateBp"], code: "too_small", message: "validation.outOfRange" },
    ]);
    expect(issues(tax.safeParse({ taxRateBp: 10000.5 }))).toEqual([
      { path: ["taxRateBp"], code: "invalid_type", message: "validation.number" },
      { path: ["taxRateBp"], code: "too_big", message: "validation.outOfRange" },
    ]);
  });

  it("does not add a safe-integer issue for a huge integer above the bound", () => {
    for (const value of [MAX_SAFE, ABOVE_SAFE, HUGE]) {
      expect(issues(tax.safeParse({ taxRateBp: value }))).toEqual([
        { path: ["taxRateBp"], code: "too_big", message: "validation.outOfRange" },
      ]);
    }
  });

  it("keeps the integer issue and the range issue for JSON numeric overflow", () => {
    expect(issues(tax.safeParse({ taxRateBp: Number.POSITIVE_INFINITY }))).toEqual([
      { path: ["taxRateBp"], code: "invalid_type", message: "validation.number" },
      { path: ["taxRateBp"], code: "too_big", message: "validation.outOfRange" },
    ]);
    expect(issues(tax.safeParse({ taxRateBp: Number.NEGATIVE_INFINITY }))).toEqual([
      { path: ["taxRateBp"], code: "invalid_type", message: "validation.number" },
      { path: ["taxRateBp"], code: "too_small", message: "validation.outOfRange" },
    ]);
  });

  it("rejects NaN and a wrong type as a number, without a range issue", () => {
    for (const value of [Number.NaN, null, true, false, "1", {}, []]) {
      expect(issues(tax.safeParse({ taxRateBp: value }))).toEqual([
        { path: ["taxRateBp"], code: "invalid_type", message: "validation.number" },
      ]);
    }
  });
});

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type _plainIn = Expect<Equal<z.input<typeof weekdaySchema>, number>>;
type _plainOut = Expect<Equal<z.output<typeof weekdaySchema>, number>>;
type _tax = Expect<Equal<PlatformClinicFinanceRequest["taxRateBp"], number | undefined>>;
type _limitIn = Expect<Equal<z.input<typeof userListHttpQuerySchema>["limit"], unknown>>;
type _limitOut = Expect<Equal<z.output<typeof userListHttpQuerySchema>["limit"], number>>;
// @ts-expect-error coerced query limit input is unknown, not a plain number
type _limitIsNotPlain = Expect<Equal<z.input<typeof userListHttpQuerySchema>["limit"], number>>;

describe("subscription integer message", () => {
  it.each([-0.5, 1.5, 10000.5, Infinity, -Infinity])(
    "keeps the configured subscription integer message for %s",
    (durationMonths) => {
      const result = subscriptionInputSchema.safeParse({
        status: "active",
        expiryMode: "duration",
        durationMonths,
        expiresOn: "",
        maxUsers: 10,
        maxBranches: 1,
      });
      expect(issues(result)[0]).toEqual({
        path: ["durationMonths"],
        code: "invalid_type",
        message: "validation.number",
      });
    },
  );
});

describe("missing number", () => {
  it("names an unconfigured missing weekday Required, and a configured missing limit too", () => {
    expect(issues(weekdaySchema.safeParse(undefined))).toEqual([
      { path: [], code: "invalid_type", message: "Required" },
    ]);
    expect(issues(maxUsersSchema.safeParse(undefined))).toEqual([
      { path: [], code: "invalid_type", message: "Required" },
    ]);
  });
});

describe("user list limit coercion", () => {
  it("keeps a numeric string and fills the default", () => {
    expect(userListHttpQuerySchema.parse({ limit: "1" }).limit).toBe(1);
    expect(userListHttpQuerySchema.parse({}).limit).toBe(50);
    expect(userListHttpQuerySchema.parse({ limit: undefined }).limit).toBe(50);
  });

  it("rejects a malformed limit and both overflow signs in the old order", () => {
    expect(issues(userListHttpQuerySchema.safeParse({ limit: "nope" }))).toEqual([
      {
        path: ["limit"],
        code: "invalid_type",
        message: "Invalid input: expected number, received NaN",
      },
    ]);
    expect(
      issues(userListHttpQuerySchema.safeParse({ limit: "1e999" })).map(({ path, code }) => ({
        path,
        code,
      })),
    ).toEqual([
      { path: ["limit"], code: "invalid_type" },
      { path: ["limit"], code: "too_big" },
    ]);
    expect(
      issues(userListHttpQuerySchema.safeParse({ limit: "-1e999" })).map(({ path, code }) => ({
        path,
        code,
      })),
    ).toEqual([
      { path: ["limit"], code: "invalid_type" },
      { path: ["limit"], code: "too_small" },
    ]);
  });

  it("lets a Symbol throw, as Zod 3 coercion did", () => {
    expect(() => userListHttpQuerySchema.parse({ limit: Symbol("x") })).toThrow(TypeError);
    expect(() => userListHttpQuerySchema.parse({ limit: Symbol("x") })).toThrow(
      "Cannot convert a Symbol value to a number",
    );
  });
});

describe("unbounded count failures", () => {
  it("names a fraction and still reports a negative count", () => {
    expect(issues(counts.safeParse({ trial: 1.5 }))).toEqual([
      { path: ["trial"], code: "invalid_type", message: "Expected integer, received float" },
    ]);
    expect(issues(counts.safeParse({ trial: -0.5 }))).toEqual([
      { path: ["trial"], code: "invalid_type", message: "Expected integer, received float" },
      // Unconfigured `.nonnegative()` text is Zod 4's default. The integer issue above is the Zod 3 text.
      { path: ["trial"], code: "too_small", message: "Too small: expected number to be >=0" },
    ]);
  });
});
