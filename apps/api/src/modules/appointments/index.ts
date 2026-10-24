// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { AppointmentsModule } from "./appointments.module.ts";
export { PgBillingReportServices } from "./persistence/pg-billing-report-services.ts";
// The medical module's `MedicalAppointmentReader` adapter, bound in medical.module.ts (ADR-0029).
export {
  PgVisitAppointments,
  type VisitAppointmentRow,
} from "./persistence/pg-visit-appointments.ts";
// The billing module's `BillingAppointmentReader` adapter, bound in billing.module.ts (finance R1-7).
export {
  PgBillingAppointments,
  type BillingAppointmentRow,
} from "./persistence/pg-billing-appointments.ts";
