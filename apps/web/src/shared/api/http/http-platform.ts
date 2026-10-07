import {
  timezoneOptions,
  type ClinicDetail,
  type CreatedClinic,
  type CreateClinicInput,
} from "@eyadex/contracts/clinics";
import { branchListResponseSchema } from "@eyadex/contracts/branches";
import {
  createClinicResponseSchema,
  type CreateClinicRequest,
  type CreateClinicResponse,
} from "@eyadex/contracts/onboarding";
import { DEFAULT_PLATFORM_SETTINGS } from "@eyadex/contracts/platform";
import {
  platformClinicDetailSchema,
  type PlatformClinicDetail,
  type UpdateLimitsRequest,
  type UpdateSubscriptionRequest,
} from "@eyadex/contracts/platform-clinics";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { toBranch } from "./http-branches";
import type { HttpContext } from "./http-context";
import { collectPages } from "./http-transport";
import { explicitExpiry, trialExpiry } from "./subscription-expiry";

const notImplemented = () => Promise.reject(new ApiError("not_implemented"));

// TODO(spec): the API requires the subscription of a new clinic; until the platform settings read
// exists these mirror the mock's defaults (trial, default trial days, 10 users, 3 branches, patients on).
const NEW_CLINIC = { maxUsers: 10, maxBranches: 3, modules: { patients: true } } as const;
// TODO(spec): the platform clinic read has no time zone yet; durations count calendar days in UTC.
const FALLBACK_TIMEZONE = "UTC";

export function toClinicDetail(detail: PlatformClinicDetail): ClinicDetail {
  return {
    id: detail.id,
    slug: detail.slug,
    nameAr: detail.nameAr,
    nameEn: detail.nameEn,
    specialty: detail.specialty,
    defaultLanguage: null,
    timezone: null,
    status: detail.status,
    expiresAt: detail.expiresAt,
    maxUsers: detail.usage.users.max,
    maxBranches: detail.usage.branches.max,
    createdAt: null,
    usersCount: detail.usage.users.used,
    branchesCount: detail.usage.branches.used,
    features: { patients: detail.modules.patients },
  };
}

export function toCreateClinicRequest(input: CreateClinicInput, now: Date): CreateClinicRequest {
  const timezone = timezoneOptions.find((tz) => tz === input.timezone);
  if (!timezone) throw new ApiError("validation", undefined, { timezone: "invalid" });
  return {
    nameAr: input.nameAr,
    nameEn: input.nameEn,
    slug: input.slug,
    specialty: input.specialty,
    defaultLanguage: input.defaultLanguage,
    timezone,
    status: "trial",
    expiresAt: trialExpiry(DEFAULT_PLATFORM_SETTINGS.defaultTrialDays, timezone, now),
    ...NEW_CLINIC,
    admin: { fullName: input.adminName, email: input.adminEmail },
  };
}

/** The API returns identifiers only; the clinic is rebuilt from what was sent. No link: it is emailed. */
export function toCreatedClinic(
  answer: CreateClinicResponse,
  request: CreateClinicRequest,
  now: Date,
): CreatedClinic {
  return {
    clinic: {
      id: answer.clinicId,
      slug: answer.slug,
      nameAr: request.nameAr,
      nameEn: request.nameEn,
      specialty: request.specialty,
      defaultLanguage: request.defaultLanguage,
      timezone: request.timezone,
      status: request.status,
      expiresAt: request.expiresAt,
      maxUsers: request.maxUsers,
      maxBranches: request.maxBranches,
      createdAt: now.toISOString(),
    },
    firstAdminInvite: {
      email: answer.invitation.email,
      token: null,
      expiresAt: answer.invitation.expiresAt,
    },
  };
}

const path = (id: string) => `/v1/platform/clinics/${encodeURIComponent(id)}`;

export function createHttpPlatform(ctx: HttpContext): ApiClient["platform"] {
  const { transport } = ctx;
  const detail = (id: string) =>
    transport.send("GET", path(id), { schema: platformClinicDetailSchema });
  // A retry under the same key must send the same body, or the API answers idempotency_conflict;
  // the expiry is derived from "today", so a retry after midnight would otherwise differ.
  const firstAttempts = new Map<string, { input: string; now: Date }>();
  return {
    async createClinic(_persona, input, idempotencyKey) {
      const sameInput = JSON.stringify(input);
      const first = firstAttempts.get(idempotencyKey);
      const now = first?.input === sameInput ? first.now : ctx.now();
      firstAttempts.set(idempotencyKey, { input: sameInput, now });
      const request = toCreateClinicRequest(input, now);
      const answer = await transport.send("POST", "/v1/platform/clinics", {
        schema: createClinicResponseSchema,
        body: request,
        idempotencyKey,
      });
      return toCreatedClinic(answer, request, now);
    },
    getClinic: async (_persona, clinicId) => toClinicDetail(await detail(clinicId)),
    async listClinicBranches(_persona, clinicId) {
      const branches = await collectPages((cursor) =>
        transport.send("GET", `${path(clinicId)}/branches`, {
          schema: branchListResponseSchema,
          query: { cursor, limit: 100 },
        }),
      );
      return branches.map((b) => toBranch(b, clinicId));
    },
    async setClinicFeature(_persona, clinicId, module, enabled) {
      await transport.send("PUT", `${path(clinicId)}/features/${module}`, {
        schema: platformClinicDetailSchema,
        body: { enabled },
      });
    },
    async updateSubscription(_persona, clinicId, input) {
      const current = await detail(clinicId);
      const subscription: UpdateSubscriptionRequest = {
        status: input.status,
        expiresAt: explicitExpiry(input, FALLBACK_TIMEZONE, ctx.now()),
      };
      await transport.send("PATCH", `${path(clinicId)}/subscription`, {
        schema: platformClinicDetailSchema,
        body: subscription,
      });
      const limits: UpdateLimitsRequest = {};
      if (input.maxUsers !== current.usage.users.max) limits.maxUsers = input.maxUsers;
      if (input.maxBranches !== current.usage.branches.max) limits.maxBranches = input.maxBranches;
      if (limits.maxUsers === undefined && limits.maxBranches === undefined) return;
      await transport.send("PATCH", `${path(clinicId)}/limits`, {
        schema: platformClinicDetailSchema,
        body: limits,
      });
    },
    listClinics: notImplemented,
    getFirstAdminInvitation: notImplemented,
    resendFirstAdminInvitation: notImplemented,
    updateClinicDetails: notImplemented,
    listClinicMembers: notImplemented,
  };
}
