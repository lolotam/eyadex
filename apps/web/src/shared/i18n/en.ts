import { enFinance, enReportExportErrors } from "./en-finance";
import { enPayments } from "./en-payments";
import { enCashClosings } from "./en-cash-closings";
import { enReportExports } from "./en-report-exports";
import { enFinanceReports } from "./en-finance-reports";
import { enNotifications } from "./en-notifications";
import { enWhatsapp } from "./en-whatsapp";
import { enRoles } from "./en-roles";
import { enPatients } from "./en-patients";
import { enAudit } from "./en-audit";
import { enUsers } from "./en-users";
import { enSettings } from "./en-settings";
import { enAccess, enAccessErrors } from "./en-access";
import { enBranches } from "./en-branches";
import { enRoutes } from "./en-routes";
import { enAppointmentErrors, enAppointments } from "./en-appointments";
import { enScheduling, enSchedulingErrors } from "./en-scheduling";
import { enMedicalErrors } from "./en-medical";
import { enVisits } from "./en-visits";
import { enClinics } from "./en-clinics";

export const en = {
  app: { name: "Eyadex", tagline: "One place for every clinic" },
  common: {
    save: "Save",
    cancel: "Cancel",
    create: "Create",
    search: "Search",
    all: "All",
    loading: "Loading…",
    next: "Next",
    previous: "Previous",
    back: "Back",
    saved: "Saved",
    retry: "Retry",
    noResults: "No results",
    active: "Active",
    inactive: "Inactive",
    open: "Open",
    edit: "Edit",
    confirm: "Confirm",
    actions: "Actions",
    showing: "Showing {count} of {total}",
    readOnly: "Read only",
    optional: "Optional",
    tryAgain: "Try again",
  },
  language: { ar: "العربية", en: "English", switch: "Language" },
  persona: {
    label: "Signed in as",
    switch: "Switch persona",
    clinic: "Clinic",
    chooseClinic: "Choose a clinic",
    platform_admin: "Platform Admin",
    clinic_admin: "Clinic Admin",
    doctor: "Doctor",
    receptionist: "Receptionist",
    technician: "Technician",
    custom: "Custom role",
    noAccountsForRole: "No account with this role in this clinic yet.",
    noCustomAccounts: "No accounts with a custom role in this clinic yet.",
    demoNote: "Demo sign-in. No passwords.",
    account: "Account",
    deactivatedTag: "deactivated",
    invitedTag: "invited: signing in accepts",
    disabledNotice:
      "Your account was deactivated. You have been signed out. Contact your clinic admin.",
    signOut: "Sign out",
  },
  ...enRoutes,
  ...enAccess,
  blocked: {
    suspendedTitle: "This clinic is suspended",
    suspendedBody:
      "Sign-in is disabled while the subscription is suspended. Please contact the platform administrator.",
    expiredTitle: "This clinic's subscription has expired",
    expiredBody:
      "Sign-in is disabled until the subscription is renewed. Please contact the platform administrator.",
    toSignIn: "Back to sign-in",
  },
  landing: {
    title: "Choose how to enter",
    body: "Explore the shared clinic-management core for every specialty with the right persona.",
    enter: "Enter",
  },
  clinicStatus: { trial: "Trial", active: "Active", suspended: "Suspended", expired: "Expired" },
  specialty: {
    psychiatry: "Psychiatry",
    psychology: "Psychology",
    dental: "Dental",
    dermatology: "Dermatology",
    obgyn: "OB/GYN",
    general: "General practice",
  },
  ...enClinics,
  ...enBranches,
  ...enUsers,
  ...enRoles,
  ...enPatients,
  ...enAudit,
  ...enSettings,
  ...enScheduling,
  ...enAppointments,
  ...enVisits,
  ...enNotifications,
  ...enWhatsapp,
  ...enFinance,
  ...enPayments,
  ...enCashClosings,
  ...enReportExports,
  ...enFinanceReports,
  validation: {
    needsView:
      "Any create, edit or deactivate permission needs view on the same area, at a scope at least as wide",
    timezone: "Choose a supported time zone",
    required: "Required",
    tooShort: "Too short",
    tooLong: "Too long",
    time: "Enter a time as HH:MM (24:00 only as an end)",
    timeOrder: "The end must be after the start",
    timeMissing: "This time does not exist in the clinic's time zone (the clock changes)",
    email: "Enter a valid email",
    slug: "Use lowercase letters, numbers and dashes",
    slugReserved: "This address is reserved by Eyadex",
    moduleRequires: "This module needs the Patients module switched on first",
    number: "Enter a number",
    min: "Must be at least 1",
    dateRequired: "Pick a date",
    unknownPermission: "This permission is not in the catalog",
    oneScope: "Pick one scope per action",
    phoneKw: "Enter 8 digits, or +965 followed by 8 digits",
    birthDate: "Enter a valid date that is not in the future",
    civilId: "Enter a valid 12-digit Kuwaiti civil ID",
    civilIdBirthDate: "The civil ID does not match the birth date",
    outOfRange: "Outside the allowed range",
    duration: "An appointment lasts 5 minutes to 8 hours",
    smtpHost: "Enter the mail server's domain name, e.g. smtp.example.com",
    controlChars: "Remove line breaks and hidden characters",
    templateName: "Use lowercase letters, numbers and underscores, as in Meta",
    templateLanguage: "Use a language code such as ar or en_US",
  },
  errors: {
    ...enAccessErrors,
    ...enSchedulingErrors,
    ...enAppointmentErrors,
    ...enMedicalErrors,
    patient_phone_taken: "This phone already belongs to another patient in this clinic",
    patient_civil_id_taken: "This civil ID already belongs to another patient in this clinic",
    email_taken: "This email already belongs to a user or a pending invitation",
    last_active_admin:
      "The clinic's last active admin cannot be deactivated or moved to another role",
    account_disabled: "This account has been deactivated",
    subscription_blocked: "The clinic's subscription does not allow access right now",
    role_inactive: "A deactivated role cannot be assigned",
    branch_inactive: "A deactivated branch cannot be assigned",
    invitation_expired: "This invitation has expired",
    invitation_cancelled: "This invitation was cancelled",
    invitation_used: "This invitation was already used",
    role_locked: "The Clinic Admin role is locked and cannot be changed or deactivated",
    role_in_use:
      "This role is held by {count} users, deactivated ones included. Move them to another role first",
    role_name_taken: "Another role in this clinic already uses this name",
    role_hidden_keys_invalid:
      "This role's permissions in the switched-off {module} module need a wider view. Switch the module on, fix them and save",
    idempotency_conflict:
      "This request was already sent with different details; close the form and start again",
    unauthorized: "Sign in to continue",
    two_factor_required: "Turn on two-step verification for your account to continue",
    invalid_credentials: "Those details are not correct; check them and try again",
    rate_limited: "Too many attempts; wait a moment and try again",
    invitation_invalid:
      "This invitation link is not valid or has expired; ask the clinic admin for a new invitation",
    account_other_area:
      "This email belongs to an account in another area; ask for an invitation with a different email",
    two_factor_busy:
      "Another two-step verification setup is in progress; wait a moment and try again",
    not_found: "Not found",
    slug_taken: "This slug is already used by another clinic",
    reserved_slug: "This address is reserved by Eyadex",
    limit_below_usage: "Limits cannot be lower than current usage",
    limit_reached: "The clinic limit has been reached",
    forbidden: "You are not allowed to do this",
    module_disabled: "This module is turned off for the clinic",
    branch_has_exclusive_members:
      "Some users have no other active branch; confirm to deactivate it",
    last_active_branch: "The clinic's last active branch cannot be deactivated",
    validation: "Some fields are invalid",
    last_active_platform_account: "The last active platform account cannot be deactivated",
    unknown: "Something went wrong",
    // Finance F1 (spec §3.3).
    price_missing: "This service has no price; set it in the services settings first",
    invoice_prefix_missing: "Set this branch's invoice prefix before issuing its first invoice",
    invoice_prefix_locked: "The invoice prefix cannot change after the branch's first invoice",
    invoice_prefix_taken: "Another branch of the clinic uses or used this prefix",
    invoice_already_exists: "An invoice already exists for this appointment or visit",
    invoice_void: "This invoice is void and cannot be changed",
    appointment_not_billable:
      "A no-show or cancelled appointment has no invoice of its own; issue a manual invoice",
    currency_locked: "The currency cannot change once a price or an invoice exists",
    currency_unsupported: "This currency is not supported",
    discount_exceeds_total: "The discount is larger than the invoice amount",
    discount_reason_required: "Write the reason for the discount",
    precondition_required: "Reload the invoice, then try again",
    version_conflict: "Someone else just changed this invoice; reload it and try again",
    send_request_conflict: "This send request was already used for another invoice or channel",
    invoice_link_expired: "This invoice link is no longer valid; ask the clinic for a new one",
    // Finance F2 (spec §4.6, §7); the web catalogue carries these codes, so they reach the UI as themselves.
    payment_method_disabled: "This payment method is turned off in the clinic settings.",
    payment_exceeds_balance: "The amount is more than the invoice still owes.",
    invoice_settled: "The invoice is already fully paid.",
    credit_insufficient: "The patient's credit is less than the amount.",
    refund_exceeds_available: "The amount is more than can be refunded.",
    payment_methods_empty: "At least one payment method must stay on.",
    cash_drawer_changed: "Cash moved since the preview. Review the closing again.",
    invoice_paid_changed:
      "The paid amount on this invoice changed since you last read it; check the movements and try again.",
    cash_closing_exists: "This branch's cash is already closed for today.",
    closing_note_required: "Write a note when there is a difference.",
    cash_drawer_out_of_range:
      "The period's net cash is beyond the allowed limit, so the drawer cannot be closed",
    ...enReportExportErrors,
    pdf_busy: "PDF generation is busy; try again shortly.",
    pdf_render_failed: "The PDF could not be generated; try again.",
  },
} as const;
