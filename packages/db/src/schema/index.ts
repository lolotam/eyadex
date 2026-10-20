// Table definitions only: no client, no query builder. Queries still go through the wrappers (ADR-0002).
export { clinics, clinicFeatures, clinicCounters } from "./clinics.ts";
export { branches } from "./branches.ts";
export { roles, permissions, rolePermissions } from "./roles.ts";
export { memberships, membershipBranches, emailReservations } from "./memberships.ts";
export { invitations, invitationBranches } from "./invitations.ts";
export { patients } from "./patients.ts";
export { auditLog, platformAuditLog, platformClinicAdminAudit } from "./audit.ts";
export { platformAuditActors } from "./audit-actors.ts";
export {
  authUsers,
  authSessions,
  authAccounts,
  authVerifications,
  authTwoFactors,
} from "./auth.ts";
export { outboxEvents, idempotencyKeys } from "./outbox.ts";
export { clinicIdempotencyKeys } from "./clinic-idempotency.ts";
export { clinicMailProviders } from "./clinic-mail-providers.ts";
export { platformSettings } from "./platform-settings.ts";
export { platformAccounts } from "./platform-accounts.ts";
export { clinicExpiryReminders } from "./clinic-expiry-reminders.ts";
export { clinicServices, providerSchedules, providerTimeOff } from "./scheduling.ts";
export { appointments } from "./appointments.ts";
export { visits, visitNotes, visitAddenda, patientMedicalProfiles } from "./medical.ts";
export { visitDiagnoses, visitPrescriptionItems } from "./medical-lists.ts";
export { icd10Codes, clinicMedicines } from "./medical-reference.ts";
export { patientAttachments } from "./attachments.ts";
export {
  clinicNotificationSettings,
  clinicWhatsappChannels,
  patientNotifications,
} from "./notifications.ts";
export { usedInvoicePrefixes, serviceProviderPrices, invoiceSequences } from "./finance.ts";
export { invoices, invoiceLines, invoiceLinks } from "./finance-invoices.ts";
export {
  clinicPaymentMethods,
  receiptSequences,
  payments,
  paymentAllocations,
  patientCredits,
} from "./finance-payments.ts";
export { refunds, refundSources, cashClosings, branchCashDrawers } from "./finance-cash.ts";
