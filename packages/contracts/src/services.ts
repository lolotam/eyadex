import { z } from "zod";
import { idSchema, pageQuerySchema, stripInvisibleControls } from "./common.ts";

/** D-15: any service, appointment or provider default lasts 5 minutes to 8 hours. */
export const DURATION_MIN_MINUTES = 5;
export const DURATION_MAX_MINUTES = 480;
/** D-15: a provider's default duration until the clinic admin changes it. */
export const DEFAULT_PROVIDER_DURATION_MINUTES = 20;

export const durationMinutesSchema = z
  .number({ invalid_type_error: "validation.number" })
  .int("validation.number")
  .min(DURATION_MIN_MINUTES, "validation.outOfRange")
  .max(DURATION_MAX_MINUTES, "validation.outOfRange");

// Invisible controls are dropped first, as role and patient names (they could only spoof or split).
const serviceName = z
  .string()
  .transform(stripInvisibleControls)
  .pipe(z.string().trim().min(1, "validation.required").max(100, "validation.tooLong"));

export const serviceStatusSchema = z.enum(["active", "inactive"]);
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;

/** D-12: a clinic-level service (name ar/en, duration). No price until the finance phase. */
export const serviceInputSchema = z
  .object({ nameAr: serviceName, nameEn: serviceName, durationMinutes: durationMinutesSchema })
  .strict();
export type ServiceInput = z.input<typeof serviceInputSchema>;

export const clinicServiceSchema = z
  .object({
    id: idSchema,
    nameAr: z.string(),
    nameEn: z.string(),
    durationMinutes: z.number().int(),
    status: serviceStatusSchema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type ClinicService = z.infer<typeof clinicServiceSchema>;

/** `GET /v1/services`: newest id last (`id` order, UUID v7), opaque cursor. */
export const serviceListHttpQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: serviceStatusSchema.optional(),
  })
  .strict();
export type ServiceListHttpQuery = z.infer<typeof serviceListHttpQuerySchema>;

export const serviceListResponseSchema = z
  .object({
    items: z.array(clinicServiceSchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type ServiceListResponse = z.infer<typeof serviceListResponseSchema>;

/** The web list query (the `ApiClient` shape, like the other areas). */
export const serviceListQuerySchema = pageQuerySchema.extend({
  status: serviceStatusSchema.nullable(),
});
export type ServiceListQuery = z.infer<typeof serviceListQuerySchema>;

/** D-1, D-15: whether a member can be booked, and the length of a booking with no service. */
export const bookingProfileInputSchema = z
  .object({ acceptsAppointments: z.boolean(), defaultDurationMinutes: durationMinutesSchema })
  .strict();
export type BookingProfileInput = z.infer<typeof bookingProfileInputSchema>;

export const bookingProfileSchema = bookingProfileInputSchema
  .extend({ memberId: idSchema })
  .strict();
export type BookingProfile = z.infer<typeof bookingProfileSchema>;
