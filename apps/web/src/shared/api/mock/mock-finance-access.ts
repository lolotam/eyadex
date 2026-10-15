import { NO_FEATURES } from "@eyadex/contracts/clinics";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import {
  clinicBlockReason,
  effectivePermissions,
  memberBranchScope,
  resolveActor,
  type Actor,
} from "./mock-actor";
import { isOwnPatient } from "./mock-own-scope";
import type { MockState } from "./mock-store";

// The API's billing guards (finance spec §3.3), in CLAUDE.md §6 order: active user → clinic access →
// finance module → key → branch scope. Hiding a button is UX; these refuse as well.

export type FinanceAccess = Actor & {
  actorName: string;
  keys: readonly string[];
  branches: { allBranches: boolean; branchIds: string[] };
};

export function guardFinance(db: MockState, persona: Persona): FinanceAccess {
  const actor = resolveActor(db, persona);
  if (clinicBlockReason(actor.clinic)) throw new ApiError("subscription_blocked");
  if (!(db.features[actor.clinic.id] ?? NO_FEATURES).finance) throw new ApiError("module_disabled");
  return {
    ...actor,
    actorName: actor.member.fullName,
    keys: effectivePermissions(db, actor),
    branches: memberBranchScope(db, actor.member),
  };
}

/** The guard plus one exact key, else forbidden. */
export function requireFinanceKey(db: MockState, persona: Persona, key: string): FinanceAccess {
  const a = guardFinance(db, persona);
  if (!a.keys.includes(key)) throw new ApiError("forbidden");
  return a;
}

const inBranches = (a: FinanceAccess, branchId: string): boolean =>
  a.branches.allBranches || a.branches.branchIds.includes(branchId);

/** Does a `clinic|branch` write key reach this branch (`create|update|deactivate:invoices`, discounts). */
export function writeReaches(
  a: FinanceAccess,
  action: "create" | "update" | "deactivate",
  resource: "invoices" | "discounts",
  branchId: string,
): boolean {
  if (a.keys.includes(`${action}:${resource}:clinic`)) return true;
  return a.keys.includes(`${action}:${resource}:branch`) && inBranches(a, branchId);
}

/** Holds the write key in any scope (the route guard, before a record is known). */
export const holdsWrite = (a: FinanceAccess, action: "create" | "update" | "deactivate") =>
  a.keys.includes(`${action}:invoices:clinic`) || a.keys.includes(`${action}:invoices:branch`);

/** Does `view:invoices:*` reach this invoice: clinic, the member's branches, or an own patient. */
export function seesInvoice(
  db: MockState,
  a: FinanceAccess,
  invoice: { branchId: string; patientId: string },
): boolean {
  if (a.keys.includes("view:invoices:clinic")) return true;
  if (a.keys.includes("view:invoices:branch") && inBranches(a, invoice.branchId)) return true;
  return (
    a.keys.includes("view:invoices:own") &&
    isOwnPatient(db, a.clinic.id, a.member.id, invoice.patientId)
  );
}

export const holdsView = (a: FinanceAccess): boolean =>
  ["clinic", "branch", "own"].some((s) => a.keys.includes(`view:invoices:${s}`));
