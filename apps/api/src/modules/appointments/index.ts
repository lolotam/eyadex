// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { AppointmentsModule } from "./appointments.module.ts";
// The medical module's `MedicalAppointmentReader` adapter, bound in medical.module.ts (ADR-0029).
export {
  PgVisitAppointments,
  type VisitAppointmentRow,
} from "./persistence/pg-visit-appointments.ts";
