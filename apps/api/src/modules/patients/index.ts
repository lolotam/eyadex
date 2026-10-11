// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { PatientsModule } from "./patients.module.ts";
// The appointments module's `BookingPatientReader` adapter, bound in appointments.module.ts (ADR-0026 §11).
export { PgBookingPatients, type BookingPatientRow } from "./persistence/pg-booking-patients.ts";
// The medical module's `MedicalPatientReader` adapter, bound in medical.module.ts (ADR-0029).
export { PgMedicalPatients, type MedicalPatientRow } from "./persistence/pg-medical-patients.ts";
// The one-off civil ID backfill command (`src/cli/backfill-civil-id.ts`, ADR-0028).
export { CivilIdCodec } from "./persistence/civil-id-codec.ts";
export {
  backfillClinicCivilIds,
  verifyClinicCivilIds,
  type BackfillCounts,
  type VerifyCounts,
} from "./persistence/civil-id-backfill.ts";
