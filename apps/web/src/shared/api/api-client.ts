import type {
  ClinicAuditItem,
  ClinicAuditListQuery,
  PlatformAuditClinicOption,
  PlatformAuditItem,
  PlatformAuditListQuery,
} from "@eyadex/contracts/audit";
import type { Page } from "@eyadex/contracts/common";
import type {
  Clinic,
  ClinicDetail,
  ClinicDetailsInput,
  ClinicListItem,
  ClinicListQuery,
  ClinicModule,
  CreateClinicInput,
  SubscriptionInput,
  CreatedClinic,
  FirstAdminInviteLink,
  FirstAdminInviteStatus,
  ClinicSettings,
  ClinicSettingsInput,
} from "@eyadex/contracts/clinics";
import type {
  Branch,
  BranchInput,
  BranchListQuery,
  BranchUsage,
} from "@eyadex/contracts/organization";
import type {
  AcceptedInvitation,
  AcceptInvitationInput,
  Invitation,
  InvitationListQuery,
  InvitationLink,
  InvitationPreview,
} from "@eyadex/contracts/invitations";
import type {
  BranchOption,
  ChangeBranchesInput,
  ChangeRoleInput,
  InviteUserInput,
  LoginAccount,
  PlatformLoginAccount,
  MembershipUserView,
  RoleOption,
  UserListQuery,
  UserUsage,
  AccountProfile,
  AccountProfileInput,
  ChangePasswordInput,
} from "@eyadex/contracts/users";
import type { PermissionDefinition } from "@eyadex/contracts/permissions";
import type {
  PatientBranchAction,
  PatientBranchOption,
  PatientDetail,
  PatientInput,
  PatientListItem,
  PatientListQuery,
  PatientWriteResult,
} from "@eyadex/contracts/patients";
import type { RoleInput, RoleListItem } from "@eyadex/contracts/roles";
import type { LoginClinic, Persona, SessionContext } from "@eyadex/contracts/session";
import type {
  InvitePlatformAccountInput,
  PlatformAccount,
  PlatformOverview,
  PlatformSettings,
} from "@eyadex/contracts/platform";
import type { AppointmentsApi } from "./appointments-client";
import type { MedicalApi } from "./medical-client";
import type { NotificationsApi } from "./notifications-client";
import type { WhatsappApi } from "./whatsapp-client";
import type { FinanceApi } from "./finance-client";
import type { PaymentsApi } from "./payments-client";
import type { CashClosingsApi } from "./cash-closings-client";
import type { NewClinicFinance } from "./new-clinic-finance";
import type { SchedulingApi } from "./scheduling-client";

/**
 * The single data boundary of the app. Screens only talk to this interface.
 * Today it is implemented by the mock adapter; later by an HTTP adapter for the NestJS API.
 */
export interface ApiClient {
  session: {
    listLoginClinics(): Promise<LoginClinic[]>;
    /** Demo sign-in: every account of a clinic, including deactivated ones (they are refused). */
    listLoginAccounts(clinicId: string): Promise<LoginAccount[]>;
    /** Demo sign-in: platform team accounts, so the platform persona is pinned to one of them. */
    listLoginPlatformAccounts(): Promise<PlatformLoginAccount[]>;
    /** Demo stand-in for the emailed link: an invited platform account joins (once). */
    acceptPlatformInvitation(memberId: string): Promise<PlatformLoginAccount>;
    getContext(persona: Persona): Promise<SessionContext>;
  };
  /** Platform admin only: every call resolves the active platform account first. */
  platform: {
    listClinics(persona: Persona, query: ClinicListQuery): Promise<Page<ClinicListItem>>;
    getClinic(persona: Persona, clinicId: string): Promise<ClinicDetail>;
    /** A retry with the same key replays the first result; a changed request is a conflict. */
    createClinic(
      persona: Persona,
      input: CreateClinicInput & NewClinicFinance,
      idempotencyKey: string,
    ): Promise<CreatedClinic>;
    /** Null once a clinic admin is active. */
    getFirstAdminInvitation(
      persona: Persona,
      clinicId: string,
    ): Promise<FirstAdminInviteStatus | null>;
    resendFirstAdminInvitation(persona: Persona, clinicId: string): Promise<FirstAdminInviteLink>;
    updateClinicDetails(
      persona: Persona,
      clinicId: string,
      input: ClinicDetailsInput,
    ): Promise<Clinic>;
    /** Screens re-read the clinic afterwards; the answer carries nothing they use. */
    updateSubscription(persona: Persona, clinicId: string, input: SubscriptionInput): Promise<void>;
    setClinicFeature(
      persona: Persona,
      clinicId: string,
      module: ClinicModule,
      enabled: boolean,
    ): Promise<void>;
    listClinicMembers(persona: Persona, clinicId: string): Promise<MembershipUserView[]>;
    listClinicBranches(persona: Persona, clinicId: string): Promise<Branch[]>;
  };
  branches: {
    list(persona: Persona, query: BranchListQuery): Promise<Page<Branch> & { usage: BranchUsage }>;
    /** A retry with the same key replays the first result; a changed request is a conflict. */
    create(persona: Persona, input: BranchInput, idempotencyKey: string): Promise<Branch>;
    update(persona: Persona, branchId: string, input: BranchInput): Promise<Branch>;
    /**
     * Rejected with branch_has_exclusive_members (details.count) while some active members would be
     * left with no active branch, unless confirmStrandedMembers is true (ADR-0012).
     */
    deactivate(
      persona: Persona,
      branchId: string,
      options?: { confirmStrandedMembers?: boolean },
    ): Promise<Branch>;
    reactivate(persona: Persona, branchId: string): Promise<Branch>;
  };
  users: {
    list(persona: Persona, query: UserListQuery): Promise<Page<MembershipUserView>>;
    usage(persona: Persona): Promise<UserUsage>;
    listRoleOptions(persona: Persona): Promise<RoleOption[]>;
    listBranchOptions(persona: Persona): Promise<BranchOption[]>;
    changeRole(
      persona: Persona,
      memberId: string,
      input: ChangeRoleInput,
    ): Promise<MembershipUserView>;
    changeBranches(
      persona: Persona,
      memberId: string,
      input: ChangeBranchesInput,
    ): Promise<MembershipUserView>;
    deactivate(persona: Persona, memberId: string): Promise<MembershipUserView>;
    reactivate(persona: Persona, memberId: string): Promise<MembershipUserView>;
  };
  invitations: {
    list(persona: Persona, query: InvitationListQuery): Promise<Page<Invitation>>;
    /**
     * Retrying with the same idempotencyKey returns the original invitation instead of a
     * duplicate-email error, so a lost response never looks like a rejection.
     */
    invite(persona: Persona, input: InviteUserInput, idempotencyKey: string): Promise<Invitation>;
    /** New link and a new 7-day expiry, emailed; the previous link stops working. */
    resend(persona: Persona, invitationId: string): Promise<Invitation>;
    /**
     * New link returned once to the caller (no email); every previous link, including the emailed
     * one, stops working. The only call that ever returns a token.
     */
    copyLink(persona: Persona, invitationId: string): Promise<InvitationLink>;
    cancel(persona: Persona, invitationId: string): Promise<Invitation>;
    /** Public: what the invitation link shows before accepting. */
    preview(token: string): Promise<InvitationPreview>;
    /** Public mock accept flow: creates the membership. */
    accept(token: string, input: AcceptInvitationInput): Promise<AcceptedInvitation>;
  };
  roles: {
    list(persona: Persona): Promise<RoleListItem[]>;
    /** Catalog keys the editor may show; keys of switched-off modules are left out. */
    catalog(persona: Persona): Promise<PermissionDefinition[]>;
    create(persona: Persona, input: RoleInput, idempotencyKey: string): Promise<RoleListItem>;
    /** Keys of switched-off modules are kept as they are, whatever the input says. */
    update(persona: Persona, roleId: string, input: RoleInput): Promise<RoleListItem>;
    deactivate(persona: Persona, roleId: string): Promise<RoleListItem>;
    reactivate(persona: Persona, roleId: string): Promise<RoleListItem>;
  };
  /** Every call is rejected with module_disabled while the clinic's patients module is off. */
  patients: {
    list(persona: Persona, query: PatientListQuery): Promise<Page<PatientListItem>>;
    /** Branches inside the caller's scope for that action (view filters, create/update form). */
    branchOptions(persona: Persona, action: PatientBranchAction): Promise<PatientBranchOption[]>;
    /** Opening a file is audited as patient access. */
    open(persona: Persona, patientId: string): Promise<PatientDetail>;
    /** A retry with the same key replays the first result; a changed request is a conflict. */
    create(
      persona: Persona,
      input: PatientInput,
      idempotencyKey: string,
    ): Promise<PatientWriteResult>;
    update(persona: Persona, patientId: string, input: PatientInput): Promise<PatientWriteResult>;
    archive(persona: Persona, patientId: string): Promise<PatientWriteResult>;
    restore(persona: Persona, patientId: string): Promise<PatientWriteResult>;
  };
  /** Services, booking profiles, weekly schedules and time off (appointments module, ADR-0026). */
  scheduling: SchedulingApi;
  appointments: AppointmentsApi;
  /** Visits, the medical file, prescriptions, attachments and the medicines list (P2). */
  medical: MedicalApi;
  /** Patient email notifications: settings, mail providers and message history (phase 3 N1). */
  notifications: NotificationsApi;
  /** The clinic's WhatsApp channel: Evolution QR link or WhatsApp Business (phase 3 N2). */
  whatsapp: WhatsappApi;
  /** Prices, invoice prefixes, invoices and the platform's clinic finance (phase 4 F1). */
  finance: FinanceApi;
  /** Finance F2: payments, patient credit and receipts. */
  payments: PaymentsApi;
  /** Finance F2 card 2b: the branch cash drawer closing. */
  cashClosings: CashClosingsApi;
  audit: {
    /** Needs view:audit_log:clinic; the caller's clinic only, newest first. */
    clinicList(persona: Persona, query: ClinicAuditListQuery): Promise<Page<ClinicAuditItem>>;
    /** Platform admin only: platform events plus clinic administrative entries, never patient ones. */
    platformList(persona: Persona, query: PlatformAuditListQuery): Promise<Page<PlatformAuditItem>>;
    /** Platform admin only: every clinic's id and names, for the clinic filter. */
    platformClinicOptions(persona: Persona): Promise<PlatformAuditClinicOption[]>;
  };
  /** Story 55: view:clinic_settings:clinic to read, update:clinic_settings:clinic to save. */
  clinicSettings: {
    get(persona: Persona): Promise<ClinicSettings>;
    update(persona: Persona, input: ClinicSettingsInput): Promise<ClinicSettings>;
  };
  /** Story 64: any active clinic account, its own profile only. */
  account: {
    get(persona: Persona): Promise<AccountProfile>;
    update(persona: Persona, input: AccountProfileInput): Promise<AccountProfile>;
    /** Better Auth's change-password over HTTP; a wrong current password is invalid_credentials. */
    changePassword(persona: Persona, input: ChangePasswordInput): Promise<void>;
  };
  /** Platform admin only. Clinic names and statuses; never patient data or counts. */
  platformOverview: {
    get(persona: Persona): Promise<PlatformOverview>;
  };
  /** Platform admin only. The last active platform account cannot be deactivated. */
  platformTeam: {
    list(persona: Persona): Promise<PlatformAccount[]>;
    /**
     * Emails a link to join; an account still invited gets a new one. A retry with the same key
     * replays the first answer; a changed request is a conflict.
     */
    invite(
      persona: Persona,
      input: InvitePlatformAccountInput,
      idempotencyKey: string,
    ): Promise<PlatformAccount>;
    deactivate(persona: Persona, accountId: string): Promise<PlatformAccount>;
    reactivate(persona: Persona, accountId: string): Promise<PlatformAccount>;
  };
  platformSettings: {
    get(persona: Persona): Promise<PlatformSettings>;
    update(persona: Persona, input: PlatformSettings): Promise<PlatformSettings>;
  };
}
