import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
// A module.ts may bind another module's adapter to a port it owns (CLAUDE.architecture.md §2.2,
// ADR-0026): identity's members and, from A2, patients' files; from phase 3 notifications' ledger
// (ADR-0031).
import { PgProviderDirectory } from "../identity/index.ts";
import { PgAppointmentNotifications } from "../notifications/index.ts";
import { PgBookingPatients } from "../patients/index.ts";
import { CLOCK, PgFilingBranches, TenancyModule, type Clock } from "../tenancy/index.ts";
import { AppointmentsController } from "./http/appointments.controller.ts";
import { SchedulesController } from "./http/schedules.controller.ts";
import { ServicesController } from "./http/services.controller.ts";
import type { AppointmentNotifications } from "./ports/appointment-notifications.ts";
import type { BookingPatientReader } from "./ports/booking-patient-reader.ts";
import type { ProviderDirectory } from "./ports/provider-directory.ts";
import type { SchedulingBranchReader } from "./ports/scheduling-branch-reader.ts";
import {
  APPOINTMENT_NOTIFICATIONS,
  APPOINTMENT_STATUS_CHANGES,
  BOOK_APPOINTMENT,
  BOOKING_PATIENT_READER,
  PROVIDER_DIRECTORY,
  SCHEDULE_CHANGES,
  SCHEDULING_BRANCH_READER,
  SERVICE_CHANGES,
} from "./ports/tokens.ts";
import { AppointmentStatusChanges } from "./use-cases/appointment-status/appointment-status.ts";
import type { AppointmentDeps } from "./use-cases/appointment-locks.ts";
import { BookAppointment } from "./use-cases/book-appointment/book-appointment.ts";
import { ScheduleChanges } from "./use-cases/schedule-changes/schedule-changes.ts";
import { ServiceChanges } from "./use-cases/service-changes/service-changes.ts";

// Typed against the module's own ports, so no adapter can drift from what the module needs.
const providers: ProviderDirectory = new PgProviderDirectory();
const branches: SchedulingBranchReader = new PgFilingBranches();
const patients: BookingPatientReader = new PgBookingPatients();

const PORTS = [
  DATABASE,
  CLOCK,
  PROVIDER_DIRECTORY,
  SCHEDULING_BRANCH_READER,
  BOOKING_PATIENT_READER,
  APPOINTMENT_NOTIFICATIONS,
];
const appointmentDeps = (
  db: Database,
  clock: Clock,
  providerDirectory: ProviderDirectory,
  branchReader: SchedulingBranchReader,
  patientReader: BookingPatientReader,
  notifications: AppointmentNotifications,
): AppointmentDeps => ({
  db,
  clock,
  ids: systemUuidV7(),
  providers: providerDirectory,
  branches: branchReader,
  patients: patientReader,
  notifications,
});

/**
 * موديول المواعيد (ADR-0026): `/v1/services`، `/v1/schedules`، `/v1/appointments`. كل الشغل على pool الـ
 * `eyadex_app` جوه `withTenant`؛ مفيش أي مسار منصة. العضويات (identity) والفروع (tenancy) وملفات
 * المراجعين (patients) بتتقري من ports الموديول بس.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [ServicesController, SchedulesController, AppointmentsController],
  providers: [
    { provide: PROVIDER_DIRECTORY, useValue: providers },
    { provide: SCHEDULING_BRANCH_READER, useValue: branches },
    { provide: BOOKING_PATIENT_READER, useValue: patients },
    {
      provide: APPOINTMENT_NOTIFICATIONS,
      inject: [CLOCK],
      useFactory: (clock: Clock): AppointmentNotifications =>
        new PgAppointmentNotifications({ ids: systemUuidV7(), clock }),
    },
    {
      provide: SERVICE_CHANGES,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new ServiceChanges({ db, clock, ids: systemUuidV7() }),
    },
    {
      provide: SCHEDULE_CHANGES,
      inject: [DATABASE, CLOCK, PROVIDER_DIRECTORY, SCHEDULING_BRANCH_READER],
      useFactory: (
        db: Database,
        clock: Clock,
        providerDirectory: ProviderDirectory,
        branchReader: SchedulingBranchReader,
      ) =>
        new ScheduleChanges({
          db,
          clock,
          ids: systemUuidV7(),
          providers: providerDirectory,
          branches: branchReader,
        }),
    },
    {
      provide: BOOK_APPOINTMENT,
      inject: PORTS,
      useFactory: (...args: Parameters<typeof appointmentDeps>) =>
        new BookAppointment(appointmentDeps(...args)),
    },
    {
      provide: APPOINTMENT_STATUS_CHANGES,
      inject: PORTS,
      useFactory: (...args: Parameters<typeof appointmentDeps>) =>
        new AppointmentStatusChanges(appointmentDeps(...args)),
    },
  ],
})
export class AppointmentsModule {}
