import { effectiveClinicStatus, NO_FEATURES } from "@eyadex/contracts/clinics";
import {
  reportPermissionScope,
  reportScopeSupported,
} from "@eyadex/contracts/finance-report-access";
import { viewScopeCovers } from "@eyadex/contracts/permissions";
import { effectivePermissions, memberBranchScope } from "./mock-actor";
import { clinicFinanceOf, exponentOf } from "./mock-finance-state";
import type { ReportContext } from "./mock-report-access";
import type { ExportJobRecord } from "./mock-report-export-state";
import type { MockState } from "./mock-store";

// The worker's `decideExportAccess` against the live state: every check re-reads the current
// account, role, clinic and keys — a stored scope is a ceiling, never a grant. A narrower scope or
// one missing frozen branch refuses the whole job; a wider scope never adds a branch.

export type ExportAccessDenial =
  "account_disabled" | "not_found" | "subscription_blocked" | "module_disabled" | "forbidden";

export type ExportAccessOutcome =
  | { readonly kind: "ready"; readonly ctx: ReportContext }
  | { readonly kind: "denied"; readonly code: ExportAccessDenial };

const denied = (code: ExportAccessDenial): ExportAccessOutcome => ({ kind: "denied", code });

/**
 * Re-derives the caller's current access for a stored job at `now`. Ready carries a reader context
 * with exactly the frozen branches and the request language; the next lifecycle step rechecks
 * around the writer, the publish and the download — this outcome grants nothing beyond this call.
 */
export function recheckExportAccess(
  db: MockState,
  job: ExportJobRecord,
  now: Date,
): ExportAccessOutcome {
  const clinic = db.clinics.find((c) => c.id === job.clinicId);
  if (!clinic) return denied("not_found");
  const member = db.members.find((m) => m.clinicId === clinic.id && m.id === job.requestedBy);
  if (!member || member.status !== "active") return denied("account_disabled");
  const role = db.roles.find((r) => r.clinicId === clinic.id && r.id === member.roleId);
  if (!role) return denied("forbidden");
  const status = effectiveClinicStatus(clinic, now.getTime());
  if (status === "suspended" || status === "expired") return denied("subscription_blocked");
  if (!(db.features[clinic.id] ?? NO_FEATURES).finance) return denied("module_disabled");
  if (!reportScopeSupported(job.report, job.scope)) return denied("not_found");
  const actor = { clinic, member, role };
  const keys = effectivePermissions(db, actor);
  const current = reportPermissionScope(keys, job.report);
  if (current === null) return denied("forbidden");
  if (job.scope === "own" && current !== "own") return denied("forbidden");
  if (!viewScopeCovers(current, job.scope)) return denied("not_found");
  const clinicBranches = db.branches.filter((branch) => branch.clinicId === clinic.id);
  const branches = memberBranchScope(db, member);
  const reach =
    current === "branch" && !branches.allBranches
      ? new Set(
          clinicBranches.map((branch) => branch.id).filter((id) => branches.branchIds.includes(id)),
        )
      : new Set(clinicBranches.map((branch) => branch.id));
  if (job.params.branchIds.some((id) => !reach.has(id))) return denied("not_found");
  const finance = clinicFinanceOf(db, clinic.id);
  const language = job.params.language;
  return {
    kind: "ready",
    ctx: {
      db,
      access: { ...actor, actorName: member.fullName, keys, branches },
      clinicId: clinic.id,
      branchIds: [...job.params.branchIds],
      branchNames: new Map(
        clinicBranches.map((branch) => [
          branch.id,
          language === "ar" ? branch.nameAr : branch.nameEn,
        ]),
      ),
      language,
      timeZone: clinic.timezone,
      facts: { currency: finance.currency, currencyExponent: exponentOf(finance.currency) },
    },
  };
}
