import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { appointmentInputSchema } from "../appointments.ts";
import { idSchema } from "../common.ts";
import { createClinicInputSchema } from "../clinics.ts";
import { resendMailProviderRequestSchema } from "../mail-provider.ts";
import { createClinicRequestSchema } from "../onboarding.ts";
import { invitePlatformAccountInputSchema, platformAccountSchema } from "../platform.ts";
import { updateSubscriptionRequestSchema } from "../platform-clinics.ts";
import { timeOffInputSchema } from "../schedules.ts";
import { inviteUserInputSchema, membershipUserSchema } from "../users.ts";

// Zod 3.25.76 uuid() is the loose hex pattern, including nil, max, uppercase, and variant
// nibbles outside RFC 4122 (0, 1, c). A later strict uuid() would reject ids already stored.
const ACCEPTED_IDS = [
  "01920000-0000-7000-8000-00000000c001",
  "00000000-0000-0000-0000-000000000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
  "01920000-0000-7000-8000-00000000C001",
  "11111111-1111-1111-1111-111111111111",
  "01920000-0000-7000-0000-00000000c001",
  "01920000-0000-7000-c000-00000000c001",
] as const;

const REJECTED_IDS = [
  "not-a-uuid",
  "01920000-0000-7000-8000-00000000c00",
  "0192000000007000800000000000c001",
];

type Parsed = { success: true; data: unknown } | { success: false; error: z.ZodError };

function issues(result: Parsed): z.ZodIssue[] {
  expect(result.success).toBe(false);
  if (result.success) return [];
  return result.error.issues;
}

describe("idSchema on Zod 3.25.76", () => {
  it.each(ACCEPTED_IDS)("accepts %s and does not rewrite it", (value) => {
    expect(idSchema.parse(value)).toBe(value);
  });

  it.each(REJECTED_IDS)("rejects %s as invalid_format", (value) => {
    expect(issues(idSchema.safeParse(value)).map((issue) => issue.code)).toEqual([
      "invalid_format",
    ]);
  });
});

describe("emails that normalize, and the ones that must not", () => {
  const normalizing = [
    ["clinic create form", createClinicInputSchema.shape.adminEmail],
    ["platform invite", invitePlatformAccountInputSchema.shape.email],
    ["mail from", resendMailProviderRequestSchema.shape.fromEmail],
  ] as const;

  it.each(normalizing)(
    "%s trims and lowercases, and names a bad address validation.email",
    (_label, schema) => {
      expect(schema.parse("  Owner@Example.Test  ")).toBe("owner@example.test");
      const failed = issues(schema.safeParse("not-an-email"));
      expect(failed).toEqual([
        expect.objectContaining({ code: "invalid_format", message: "validation.email" }),
      ]);
    },
  );

  it("keeps a stored user or platform address as written, without an i18n key", () => {
    expect(membershipUserSchema.shape.email.parse("Owner@Example.Test")).toBe("Owner@Example.Test");
    expect(platformAccountSchema.shape.email.parse("Owner@Example.Test")).toBe(
      "Owner@Example.Test",
    );
    for (const schema of [membershipUserSchema.shape.email, platformAccountSchema.shape.email]) {
      const failed = issues(schema.safeParse("  owner@example.test  "));
      expect(failed.map((issue) => issue.code)).toEqual(["invalid_format"]);
      expect(failed.map((issue) => issue.message)).not.toContain("validation.email");
    }
  });

  it("normalizes the create-clinic request address and does not attach validation.email", () => {
    const parsed = createClinicRequestSchema.parse({
      nameAr: "Synthetic",
      nameEn: "Synthetic",
      slug: "synthetic",
      specialty: "general",
      defaultLanguage: "ar",
      timezone: "Asia/Kuwait",
      status: "trial",
      maxUsers: 1,
      maxBranches: 1,
      modules: { patients: false, appointments: false, medical: false, finance: false },
      admin: { fullName: "Synthetic Staff", email: "  Owner@Example.Test  " },
    });
    expect(parsed.admin.email).toBe("owner@example.test");
    const failed = issues(
      createClinicRequestSchema.safeParse({
        nameAr: "Synthetic",
        nameEn: "Synthetic",
        slug: "synthetic",
        specialty: "general",
        defaultLanguage: "ar",
        timezone: "Asia/Kuwait",
        status: "trial",
        maxUsers: 1,
        maxBranches: 1,
        modules: { patients: false, appointments: false, medical: false, finance: false },
        admin: { fullName: "Synthetic Staff", email: "not-an-email" },
      }),
    );
    expect(failed).toEqual([
      expect.objectContaining({ path: ["admin", "email"], code: "invalid_format" }),
    ]);
    expect(failed.map((issue) => issue.message)).not.toContain("validation.email");
  });

  it("names a bad invite address and a bad role id with their i18n keys", () => {
    const parsed = inviteUserInputSchema.parse({
      fullName: "Synthetic Staff",
      email: "  Owner@Example.Test  ",
      roleId: ACCEPTED_IDS[0],
      allBranches: true,
      branchIds: [],
    });
    expect(parsed.email).toBe("owner@example.test");
    expect(
      issues(
        inviteUserInputSchema.safeParse({
          fullName: "Synthetic Staff",
          email: "not-an-email",
          roleId: "not-a-uuid",
          allBranches: true,
          branchIds: [],
        }),
      ).map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })),
    ).toEqual([
      { path: ["email"], code: "invalid_format", message: "validation.email" },
      { path: ["roleId"], code: "invalid_format", message: "validation.required" },
    ]);
  });
});

describe("datetime, leap day, and offset on the exported contracts", () => {
  const createdAt = membershipUserSchema.shape.createdAt;

  it("accepts Z and a leap day, and rejects an offset, a non-leap day, and a leap second", () => {
    expect(createdAt.parse("2026-10-26T12:00:00Z")).toBe("2026-10-26T12:00:00Z");
    expect(createdAt.parse("2024-02-29T00:00:00Z")).toBe("2024-02-29T00:00:00Z");
    for (const value of [
      "2026-10-26T12:00:00+03:00",
      "2026-02-29T00:00:00Z",
      "2016-12-31T23:59:60Z",
    ]) {
      expect(issues(createdAt.safeParse(value)).map((issue) => issue.code)).toEqual([
        "invalid_format",
      ]);
    }
  });

  it("keeps a compact offset on subscription expiry and time off", () => {
    expect(
      updateSubscriptionRequestSchema.parse({ expiresAt: "2026-10-26T12:00:00+0300" }),
    ).toEqual({
      expiresAt: "2026-10-26T12:00:00+0300",
    });
    expect(
      updateSubscriptionRequestSchema.parse({ expiresAt: "2026-10-26T12:00:00+03:00" }),
    ).toEqual({
      expiresAt: "2026-10-26T12:00:00+03:00",
    });
    expect(
      timeOffInputSchema.parse({
        startsAt: "2026-10-26T09:00:00+0300",
        endsAt: "2026-10-26T10:00:00+03:00",
        note: null,
      }),
    ).toEqual({
      startsAt: "2026-10-26T09:00:00+0300",
      endsAt: "2026-10-26T10:00:00+03:00",
      note: null,
    });
    expect(
      issues(
        updateSubscriptionRequestSchema.safeParse({ expiresAt: "2026-02-29T00:00:00+00:00" }),
      ).map((issue) => ({ path: issue.path, code: issue.code })),
    ).toEqual([{ path: ["expiresAt"], code: "invalid_format" }]);
  });

  it("accepts a non-RFC uuid on an appointment and rejects a non-zero second", () => {
    const loose = "11111111-1111-1111-1111-111111111111";
    expect(
      appointmentInputSchema.parse({
        branchId: loose,
        providerMembershipId: ACCEPTED_IDS[0],
        patientId: ACCEPTED_IDS[0],
        serviceId: null,
        startsAt: "2026-10-26T09:00:00+03:00",
        endsAt: null,
        overbook: false,
      }).branchId,
    ).toBe(loose);
    expect(
      issues(
        appointmentInputSchema.safeParse({
          branchId: ACCEPTED_IDS[0],
          providerMembershipId: ACCEPTED_IDS[0],
          patientId: ACCEPTED_IDS[0],
          serviceId: null,
          startsAt: "2026-10-26T09:00:30Z",
          endsAt: null,
          overbook: false,
        }),
      ).map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })),
    ).toEqual([{ path: ["startsAt"], code: "custom", message: "validation.time" }]);
  });
});
