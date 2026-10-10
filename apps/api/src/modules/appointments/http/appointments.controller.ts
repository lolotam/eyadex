import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  appointmentCancelSchema,
  appointmentDayQuerySchema,
  appointmentInputSchema,
  appointmentRescheduleSchema,
  appointmentStatusInputSchema,
  type AppointmentBranches,
  type AppointmentCancel,
  type AppointmentDay,
  type AppointmentDayQuery,
  type AppointmentInput,
  type AppointmentRescheduleInput,
  type AppointmentStatusInput,
  type AppointmentWriteResponse,
} from "@eyadex/contracts/appointments";
import {
  appointmentMonthQuerySchema,
  appointmentWeekQuerySchema,
  type AppointmentMonth,
  type AppointmentMonthQuery,
  type AppointmentWeek,
  type AppointmentWeekQuery,
} from "@eyadex/contracts/appointment-calendar";
import { idSchema } from "@eyadex/contracts/common";
import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import type { AppointmentActor } from "../domain/booking-rules.ts";
import type { BookingPatientReader } from "../ports/booking-patient-reader.ts";
import type { ProviderDirectory } from "../ports/provider-directory.ts";
import type { SchedulingBranchReader } from "../ports/scheduling-branch-reader.ts";
import {
  APPOINTMENT_STATUS_CHANGES,
  BOOK_APPOINTMENT,
  BOOKING_PATIENT_READER,
  PROVIDER_DIRECTORY,
  SCHEDULING_BRANCH_READER,
} from "../ports/tokens.ts";
import {
  listAppointmentBranches,
  readAppointmentDay,
  type DayDeps,
} from "../queries/appointment-day.ts";
import { readAppointmentMonth, readAppointmentWeek } from "../queries/appointment-calendar.ts";
import type { AppointmentStatusChanges } from "../use-cases/appointment-status/appointment-status.ts";
import type { BookAppointment } from "../use-cases/book-appointment/book-appointment.ts";

// A malformed id is an unknown record: 404, the same answer as another clinic's id (ISO-02).
const idOf = (raw: string): string => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("not_found");
  return parsed.data;
};

const keyOf = (raw: string | undefined): string => {
  const key = idempotencyKeySchema.safeParse(raw);
  if (!key.success) {
    throw new ApiError("validation", [{ path: ["Idempotency-Key"], code: "required" }]);
  }
  return key.data;
};

const actorOf = (request: ClinicRequest): AppointmentActor => ({
  clinicId: request.clinicContext.clinicId,
  userId: request.clinicContext.userId,
  membershipId: request.clinicContext.membershipId,
  timezone: request.clinicMember.clinic.timezone,
  language: request.clinicMember.preferredLanguage,
  permissions: request.clinicContext.permissions,
  member: request.clinicContext.branchScope,
});

// Spec §4 and §5 (slice A2, ADR-0026 §11). Thin: validate → call → map. Every route needs the module.
// The reads admit `own` (A3; the guard's grantFor still reports a wider key) and the queries narrow it.
@Controller("appointments")
export class AppointmentsController {
  private readonly reads: DayDeps;

  constructor(
    @Inject(DATABASE) db: Database,
    @Inject(BOOK_APPOINTMENT) private readonly booking: BookAppointment,
    @Inject(APPOINTMENT_STATUS_CHANGES) private readonly statuses: AppointmentStatusChanges,
    @Inject(PROVIDER_DIRECTORY) providers: ProviderDirectory,
    @Inject(SCHEDULING_BRANCH_READER) branches: SchedulingBranchReader,
    @Inject(BOOKING_PATIENT_READER) patients: BookingPatientReader,
  ) {
    this.reads = { db, providers, branches, patients };
  }

  @Get("branches")
  @Require("view:appointments:own")
  @RequiresFeature("appointments")
  branches(@Req() request: ClinicRequest): Promise<AppointmentBranches> {
    return listAppointmentBranches(this.reads, actorOf(request));
  }

  @Get("day")
  @Require("view:appointments:own")
  @RequiresFeature("appointments")
  day(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(appointmentDayQuerySchema)) query: AppointmentDayQuery,
  ): Promise<AppointmentDay> {
    return readAppointmentDay(this.reads, actorOf(request), query);
  }

  @Get("week")
  @Require("view:appointments:own")
  @RequiresFeature("appointments")
  week(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(appointmentWeekQuerySchema)) query: AppointmentWeekQuery,
  ): Promise<AppointmentWeek> {
    return readAppointmentWeek(this.reads, actorOf(request), query);
  }

  @Get("month")
  @Require("view:appointments:own")
  @RequiresFeature("appointments")
  month(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(appointmentMonthQuerySchema)) query: AppointmentMonthQuery,
  ): Promise<AppointmentMonth> {
    return readAppointmentMonth(this.reads, actorOf(request), query);
  }

  @Post()
  @HttpCode(201)
  @Require("create:appointments:branch")
  @RequiresFeature("appointments")
  create(
    @Req() request: ClinicRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(appointmentInputSchema)) body: AppointmentInput,
  ): Promise<AppointmentWriteResponse> {
    return this.booking.create(actorOf(request), body, keyOf(rawKey));
  }

  @Put(":id")
  @Require("update:appointments:branch")
  @RequiresFeature("appointments")
  reschedule(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(appointmentRescheduleSchema)) body: AppointmentRescheduleInput,
  ): Promise<AppointmentWriteResponse> {
    return this.booking.reschedule(actorOf(request), idOf(id), body);
  }

  @Post(":id/status")
  @HttpCode(200)
  @Require("update:appointments:branch")
  @RequiresFeature("appointments")
  setStatus(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(appointmentStatusInputSchema)) body: AppointmentStatusInput,
  ): Promise<AppointmentWriteResponse> {
    return this.statuses.setStatus(actorOf(request), idOf(id), body);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @Require("update:appointments:branch")
  @RequiresFeature("appointments")
  cancel(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(appointmentCancelSchema)) body: AppointmentCancel,
  ): Promise<AppointmentWriteResponse> {
    return this.statuses.cancel(actorOf(request), idOf(id), body);
  }
}
