import { describe, expect, it } from "vitest";
import type {
  MeResponse,
  PermissionCatalogueResponse,
  RoleSummary,
} from "@eyadex/contracts/access";
import type { BranchDetail } from "@eyadex/contracts/branches";
import type {
  AcceptInvitationResponse,
  InspectInvitationResponse,
} from "@eyadex/contracts/invitation-acceptance";
import type { Invitation, InvitationLink } from "@eyadex/contracts/invitations";
import type { CreateClinicResponse } from "@eyadex/contracts/onboarding";
import type { PlatformClinicDetail } from "@eyadex/contracts/platform-clinics";
import type {
  BranchOptionListResponse,
  RoleOptionListResponse,
} from "@eyadex/contracts/role-admin";
import type { MembershipUserView } from "@eyadex/contracts/users";
import { toBranch } from "../http-branches";
import { toAccepted, toInvitation, toInvitationLink, toPreview } from "../http-invitations";
import { toClinicDetail, toCreatedClinic } from "../http-platform";
import { toCatalog, toRoleListItem } from "../http-roles";
import { contextFromMe } from "../http-session";
import { toBranchOption, toRoleOption, toUserView } from "../http-users";

/** Exact type equality: a mapper that took a looser or different input would fail typecheck. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type In<F extends (...args: never[]) => unknown> = Parameters<F>[0];

const checks = {
  toBranch: true,
  toBranchOption: true,
  toUserView: true,
  toRoleOption: true,
  toRoleListItem: true,
  toCatalog: true,
  toInvitation: true,
  toInvitationLink: true,
  toPreview: true,
  toAccepted: true,
  toClinicDetail: true,
  toCreatedClinic: true,
  contextFromMe: true,
} satisfies {
  toBranch: Equal<In<typeof toBranch>, BranchDetail>;
  toBranchOption: Equal<In<typeof toBranchOption>, BranchOptionListResponse["items"][number]>;
  toUserView: Equal<In<typeof toUserView>, MembershipUserView>;
  toRoleOption: Equal<In<typeof toRoleOption>, RoleOptionListResponse["items"][number]>;
  toRoleListItem: Equal<In<typeof toRoleListItem>, RoleSummary>;
  toCatalog: Equal<In<typeof toCatalog>, PermissionCatalogueResponse>;
  toInvitation: Equal<In<typeof toInvitation>, Invitation>;
  toInvitationLink: Equal<In<typeof toInvitationLink>, InvitationLink>;
  toPreview: Equal<In<typeof toPreview>, InspectInvitationResponse>;
  toAccepted: Equal<In<typeof toAccepted>, AcceptInvitationResponse>;
  toClinicDetail: Equal<In<typeof toClinicDetail>, PlatformClinicDetail>;
  toCreatedClinic: Equal<In<typeof toCreatedClinic>, CreateClinicResponse>;
  contextFromMe: Equal<In<typeof contextFromMe>, MeResponse>;
};

describe("mapper inputs are the API schemas' inferred types", () => {
  it("is checked at compile time", () => {
    expect(Object.values(checks).every(Boolean)).toBe(true);
  });
});
