import type { Page } from "@contracts/common";
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
} from "@contracts/clinics";
import type { Branch, BranchInput, BranchListQuery, BranchUsage } from "@contracts/organization";
import type {
  AcceptedInvitation,
  AcceptInvitationInput,
  Invitation,
  InvitationListQuery,
  InvitationPreview,
} from "@contracts/invitations";
import type {
  BranchOption,
  ChangeBranchesInput,
  ChangeRoleInput,
  InviteUserInput,
  LoginAccount,
  MembershipUserView,
  RoleOption,
  UserListQuery,
  UserUsage,
} from "@contracts/users";
import type { PermissionDefinition } from "@contracts/permissions";
import type {
  PatientBranchAction,
  PatientBranchOption,
  PatientDetail,
  PatientInput,
  PatientListItem,
  PatientListQuery,
} from "@contracts/patients";
import type { RoleInput, RoleListItem } from "@contracts/roles";
import type { LoginClinic, Persona, SessionContext } from "@contracts/session";

/**
 * The single data boundary of the app. Screens only talk to this interface.
 * Today it is implemented by the mock adapter; later by an HTTP adapter for the NestJS API.
 */
export interface ApiClient {
  session: {
    listLoginClinics(): Promise<LoginClinic[]>;
    /** Demo sign-in: every account of a clinic, including deactivated ones (they are refused). */
    listLoginAccounts(clinicId: string): Promise<LoginAccount[]>;
    getContext(persona: Persona): Promise<SessionContext>;
  };
  platform: {
    listClinics(query: ClinicListQuery): Promise<Page<ClinicListItem>>;
    getClinic(clinicId: string): Promise<ClinicDetail>;
    createClinic(input: CreateClinicInput): Promise<CreatedClinic>;
    /** Null once a clinic admin is active. */
    getFirstAdminInvitation(clinicId: string): Promise<FirstAdminInviteStatus | null>;
    resendFirstAdminInvitation(clinicId: string): Promise<FirstAdminInviteLink>;
    updateClinicDetails(clinicId: string, input: ClinicDetailsInput): Promise<Clinic>;
    updateSubscription(clinicId: string, input: SubscriptionInput): Promise<Clinic>;
    setClinicFeature(clinicId: string, module: ClinicModule, enabled: boolean): Promise<void>;
    listClinicMembers(clinicId: string): Promise<MembershipUserView[]>;
    listClinicBranches(clinicId: string): Promise<Branch[]>;
  };
  branches: {
    list(persona: Persona, query: BranchListQuery): Promise<Page<Branch> & { usage: BranchUsage }>;
    create(persona: Persona, input: BranchInput): Promise<Branch>;
    update(persona: Persona, branchId: string, input: BranchInput): Promise<Branch>;
    deactivate(persona: Persona, branchId: string): Promise<Branch>;
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
    /** New expiry, same invitation and link. */
    resend(persona: Persona, invitationId: string): Promise<Invitation>;
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
    create(persona: Persona, input: RoleInput): Promise<RoleListItem>;
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
    create(persona: Persona, input: PatientInput, idempotencyKey: string): Promise<PatientDetail>;
    update(persona: Persona, patientId: string, input: PatientInput): Promise<PatientDetail>;
    archive(persona: Persona, patientId: string): Promise<PatientDetail>;
    restore(persona: Persona, patientId: string): Promise<PatientDetail>;
  };
}
