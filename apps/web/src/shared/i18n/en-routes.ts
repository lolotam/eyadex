// Navigation labels and each page's head (browser tab title and description, ADR-0025).
// The tab title adds " · Eyadex" to `title`; the brand stays in Latin letters in both languages.
export const enRoutes = {
  nav: {
    platformArea: "Platform",
    clinicArea: "Clinic",
    overview: "Overview",
    clinics: "Clinics",
    team: "Platform team",
    audit: "Audit log",
    settings: "Settings",
    branches: "Branches",
    users: "Users",
    roles: "Roles & permissions",
    patients: "Patients",
    appointments: "Appointments",
    visits: "Visits",
    invoices: "Invoices",
    account: "My account",
    menu: "Menu",
  },
  routes: {
    login: { title: "Sign in", description: "Sign in to Eyadex." },
    forbidden: { title: "Not allowed", description: "You do not have access to this page." },
    invite: { title: "Accept invitation", description: "Join your clinic on Eyadex." },
    clinic: { title: "Clinic", description: "Clinic workspace." },
    clinicOverview: {
      title: "Clinic overview",
      description: "Counts, subscription and usage for your clinic.",
    },
    clinicAccount: { title: "My account", description: "Your profile and language." },
    clinicAppointments: {
      title: "Appointments",
      description: "The branch day: book, move and follow appointments.",
    },
    clinicAudit: { title: "Audit log", description: "Every change inside the clinic." },
    clinicBranches: {
      title: "Clinic Branches",
      description: "Manage clinic locations, contact details, and operating status.",
    },
    clinicPatients: { title: "Patients", description: "Patient files and registration." },
    clinicInvoices: {
      title: "Invoices",
      description: "The clinic's invoices: search, filter and open one.",
    },
    clinicInvoice: {
      title: "Invoice",
      description: "An invoice's lines, discounts, tax and total, with PDF, send and void.",
    },
    clinicInvoiceNew: {
      title: "New invoice",
      description: "Issue an invoice for an appointment, a visit or by hand.",
    },
    clinicSettingsFinance: {
      title: "Finance settings",
      description: "Currency, tax, commercial registration, logo and invoice prefixes.",
    },
    clinicVisits: {
      title: "Visits",
      description: "Start a walk-in visit for a patient without an appointment.",
    },
    clinicVisit: {
      title: "Visit",
      description: "A visit's doctor notes, diagnoses, prescription and attachments.",
    },
    clinicSettingsNotifications: {
      title: "Notifications",
      description: "Which emails the clinic sends to patients.",
    },
    clinicSettingsWhatsapp: {
      title: "WhatsApp",
      description: "Link the clinic's WhatsApp number for patient messages.",
    },
    clinicSettingsEmail: {
      title: "Email senders",
      description: "The clinic's primary and fallback mail senders.",
    },
    clinicSettingsMedicines: {
      title: "Medicines",
      description: "The clinic's list of frequent medicines.",
    },
    clinicPatientFile: {
      title: "Patient file",
      description: "A patient file; every opening is recorded in the audit log.",
    },
    clinicRoles: {
      title: "Roles & permissions",
      description: "Define who can do what in the clinic.",
    },
    clinicSettings: { title: "Clinic settings", description: "Clinic preferences." },
    clinicSettingsServices: {
      title: "Services",
      description: "The clinic's services and their durations.",
    },
    clinicSettingsSchedules: {
      title: "Work schedules",
      description: "Weekly working hours and time off per provider.",
    },
    clinicUsers: { title: "Users", description: "Invite and manage clinic users." },
    platform: { title: "Platform", description: "Platform administration for Eyadex." },
    platformOverview: {
      title: "Platform overview",
      description: "Clinics by status and upcoming expiries.",
    },
    platformAudit: { title: "Platform audit log", description: "Every platform-level change." },
    platformClinics: {
      title: "Clinics",
      description: "Search and manage every clinic on the platform.",
    },
    platformClinic: {
      title: "Clinic",
      description: "Clinic details, subscription, modules, users and branches.",
    },
    platformNewClinic: {
      title: "New clinic",
      description: "Create a clinic together with its first admin.",
    },
    platformSettings: { title: "Platform settings", description: "Platform-wide settings." },
    platformTeam: { title: "Platform team", description: "Platform team accounts." },
  },
};
