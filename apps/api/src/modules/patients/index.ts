// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { PatientsModule } from "./patients.module.ts";
// The appointments module's `BookingPatientReader` adapter, bound in appointments.module.ts (ADR-0026 §11).
export { PgBookingPatients, type BookingPatientRow } from "./persistence/pg-booking-patients.ts";
