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
} from "@contracts/clinics";
import type { Branch, BranchInput, BranchListQuery, BranchUsage, MemberView } from "@contracts/organization";
import type { LoginClinic, Persona, SessionContext } from "@contracts/session";

/**
 * The single data boundary of the app. Screens only talk to this interface.
 * Today it is implemented by the mock adapter; later by an HTTP adapter for the NestJS API.
 */
export interface ApiClient {
  session: {
    listLoginClinics(): Promise<LoginClinic[]>;
    getContext(persona: Persona): Promise<SessionContext>;
  };
  platform: {
    listClinics(query: ClinicListQuery): Promise<Page<ClinicListItem>>;
    getClinic(clinicId: string): Promise<ClinicDetail>;
    createClinic(input: CreateClinicInput): Promise<Clinic>;
    updateClinicDetails(clinicId: string, input: ClinicDetailsInput): Promise<Clinic>;
    updateSubscription(clinicId: string, input: SubscriptionInput): Promise<Clinic>;
    setClinicFeature(clinicId: string, module: ClinicModule, enabled: boolean): Promise<void>;
    listClinicMembers(clinicId: string): Promise<MemberView[]>;
    listClinicBranches(clinicId: string): Promise<Branch[]>;
  };
  branches: {
    list(persona: Persona, query: BranchListQuery): Promise<Page<Branch> & { usage: BranchUsage }>;
    create(persona: Persona, input: BranchInput): Promise<Branch>;
    update(persona: Persona, branchId: string, input: BranchInput): Promise<Branch>;
    deactivate(persona: Persona, branchId: string): Promise<Branch>;
    reactivate(persona: Persona, branchId: string): Promise<Branch>;
  };
}
