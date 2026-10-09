import {
  providerListResponseSchema,
  providerScheduleSchema,
  scheduleWriteResponseSchema,
} from "@eyadex/contracts/schedules";
import {
  bookingProfileSchema,
  clinicServiceSchema,
  serviceListResponseSchema,
  type ServiceInput,
} from "@eyadex/contracts/services";
import type { SchedulingApi } from "../scheduling-client";
import type { HttpContext } from "./http-context";

const service = (id: string) => `/v1/services/${encodeURIComponent(id)}`;
const schedule = (id: string) => `/v1/schedules/${encodeURIComponent(id)}`;
const bookingProfile = (id: string) => `/v1/users/${encodeURIComponent(id)}/booking-profile`;

/** The form's fields, and nothing else the caller's object may carry. */
const toServiceBody = (input: ServiceInput): ServiceInput => ({
  nameAr: input.nameAr,
  nameEn: input.nameEn,
  durationMinutes: input.durationMinutes,
});

export function createHttpScheduling(ctx: HttpContext): SchedulingApi {
  const { transport } = ctx;
  return {
    async listServices(_persona, query) {
      const page = await transport.send("GET", "/v1/services", {
        schema: serviceListResponseSchema,
        query: { cursor: query.cursor, limit: query.limit, status: query.status },
      });
      return { items: page.items, nextCursor: page.nextCursor, total: page.total };
    },
    createService: (_persona, input, idempotencyKey) =>
      transport.send("POST", "/v1/services", {
        schema: clinicServiceSchema,
        body: toServiceBody(input),
        idempotencyKey,
      }),
    updateService: (_persona, serviceId, input) =>
      transport.send("PUT", service(serviceId), {
        schema: clinicServiceSchema,
        body: toServiceBody(input),
      }),
    deactivateService: (_persona, serviceId) =>
      transport.send("POST", `${service(serviceId)}/deactivate`, { schema: clinicServiceSchema }),
    reactivateService: (_persona, serviceId) =>
      transport.send("POST", `${service(serviceId)}/reactivate`, { schema: clinicServiceSchema }),
    getBookingProfile: (_persona, memberId) =>
      transport.send("GET", bookingProfile(memberId), { schema: bookingProfileSchema }),
    setBookingProfile: (_persona, memberId, input) =>
      transport.send("PUT", bookingProfile(memberId), {
        schema: bookingProfileSchema,
        body: {
          acceptsAppointments: input.acceptsAppointments,
          defaultDurationMinutes: input.defaultDurationMinutes,
        },
      }),
    async listProviders() {
      const list = await transport.send("GET", "/v1/schedules/providers", {
        schema: providerListResponseSchema,
      });
      return list.items;
    },
    getProviderSchedule: (_persona, membershipId) =>
      transport.send("GET", schedule(membershipId), { schema: providerScheduleSchema }),
    replaceBranchSchedule: (_persona, membershipId, branchId, input) =>
      transport.send("PUT", `${schedule(membershipId)}/branches/${encodeURIComponent(branchId)}`, {
        schema: scheduleWriteResponseSchema,
        body: {
          shifts: input.shifts.map((s) => ({
            weekday: s.weekday,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
          })),
        },
      }),
    addTimeOff: (_persona, membershipId, input) =>
      transport.send("POST", `${schedule(membershipId)}/time-off`, {
        schema: scheduleWriteResponseSchema,
        body: { startsAt: input.startsAt, endsAt: input.endsAt, note: input.note },
      }),
    cancelTimeOff: (_persona, membershipId, timeOffId) =>
      transport.send(
        "POST",
        `${schedule(membershipId)}/time-off/${encodeURIComponent(timeOffId)}/cancel`,
        { schema: scheduleWriteResponseSchema },
      ),
  };
}
