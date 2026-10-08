import {
  timezoneOptions,
  type ClinicDetail,
  type ClinicListItem,
  type ClinicListQuery,
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
  platformClinicListResponseSchema,
  type PlatformClinicDetail,
  type UpdateLimitsRequest,
  type UpdateSubscriptionRequest,
} from "@eyadex/contracts/platform-clinics";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { toBranch } from "./http-branches";
import type { HttpContext } from "./http-context";
import { collectPages } from "./http-transport";
import { explicitExpiry } from "./subscription-expiry";

const notImplemented = () => Promise.reject(new ApiError("not_implemented"));

// TODO(spec): the API requires the subscription of a new clinic; until the platform settings read
// exists these mirror the mock's defaults (trial, default trial days, 10 users, 3 branches, patients on).
const NEW_CLINIC = { maxUsers: 10, maxBranches: 3, modules: { patients: true } } as const;
export function toClinicListItem(detail: PlatformClinicDetail): ClinicListItem {
  return {
    id: detail.id,
    slug: detail.slug,
    nameAr: detail.nameAr,
    nameEn: detail.nameEn,
    specialty: detail.specialty,
    defaultLanguage: detail.defaultLanguage,
    timezone: detail.timezone,
    status: detail.status,
    expiresAt: detail.expiresAt,
    maxUsers: detail.usage.users.max,
    maxBranches: detail.usage.branches.max,
    createdAt: detail.createdAt,
    usersCount: detail.usage.users.used,
    branchesCount: detail.usage.branches.used,
  };
}

export function toClinicDetail(detail: PlatformClinicDetail): ClinicDetail {
  return { ...toClinicListItem(detail), features: { patients: detail.modules.patients } };
}

export function platformListQuery(query: ClinicListQuery) {
  const search = query.search.trim();
  return {
    cursor: query.cursor,
    limit: query.limit,
    search: search === "" ? null : search,
    status: query.status,
    specialty: query.specialty,
  };
}

/** No expiry is sent: the server derives the trial on its own clock (ADR-0016), so the body never depends on the device. */
export function toCreateClinicRequest(input: CreateClinicInput): CreateClinicRequest {
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
    trialDays: DEFAULT_PLATFORM_SETTINGS.defaultTrialDays,
    ...NEW_CLINIC,
    admin: { fullName: input.adminName, email: input.adminEmail },
  };
}

/** The API returns identifiers only; the clinic is read back (its expiry is the server's). No link: it is emailed. */
export function toCreatedClinic(
  answer: CreateClinicResponse,
  detail: PlatformClinicDetail,
): CreatedClinic {
  const { usersCount: _u, branchesCount: _b, ...clinic } = toClinicListItem(detail);
  void _u;
  void _b;
  return {
    clinic,
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
  return {
    // The body holds no clock-derived value, so a retry under the same key always sends the same body.
    async createClinic(_persona, input, idempotencyKey) {
      const answer = await transport.send("POST", "/v1/platform/clinics", {
        schema: createClinicResponseSchema,
        body: toCreateClinicRequest(input),
        idempotencyKey,
      });
      return toCreatedClinic(answer, await detail(answer.clinicId));
    },
    async listClinics(_persona, query) {
      const page = await transport.send("GET", "/v1/platform/clinics", {
        schema: platformClinicListResponseSchema,
        query: platformListQuery(query),
      });
      return {
        items: page.items.map(toClinicListItem),
        nextCursor: page.nextCursor,
        total: page.total,
      };
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
        expiresAt: explicitExpiry(input, current.timezone, ctx.now()),
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
    getFirstAdminInvitation: notImplemented,
    resendFirstAdminInvitation: notImplemented,
    updateClinicDetails: notImplemented,
    listClinicMembers: notImplemented,
  };
}
