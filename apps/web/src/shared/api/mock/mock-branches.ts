import type { Branch, BranchInput, BranchListQuery } from "@eyadex/contracts/organization";
import { branchInputSchema, branchListQuerySchema } from "@eyadex/contracts/organization";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { authorize } from "./mock-actor";
import { writeClinicAudit } from "./mock-audit";
import { delay, getState, newId, persist, type MockState } from "./mock-store";

function validateInput(raw: BranchInput): BranchInput {
  const result = branchInputSchema.safeParse(raw);
  if (!result.success) throw new ApiError("validation");
  return result.data;
}

function findBranch(db: MockState, clinicId: string, branchId: string): Branch {
  const branch = db.branches.find((item) => item.clinicId === clinicId && item.id === branchId);
  if (!branch) throw new ApiError("not_found");
  return branch;
}

function usage(db: MockState, clinicId: string) {
  const clinic = db.clinics.find((item) => item.id === clinicId);
  if (!clinic) throw new ApiError("not_found");
  return {
    active: db.branches.filter((item) => item.clinicId === clinicId && item.isActive).length,
    limit: clinic.maxBranches,
  };
}

function enforceLimit(db: MockState, clinicId: string) {
  const current = usage(db, clinicId);
  if (current.active >= current.limit) throw new ApiError("limit_reached", undefined, current);
}

function audit(
  db: MockState,
  clinicId: string,
  actorName: string,
  action: string,
  before: Branch | null,
  after: Branch | null,
) {
  writeClinicAudit(db, { clinicId, actorName, action, entity: "branch", before, after });
}

export function createMockBranches(): ApiClient["branches"] {
  return {
    async list(persona, rawQuery) {
      await delay();
      const parsed = branchListQuerySchema.safeParse(rawQuery);
      if (!parsed.success) throw new ApiError("validation");
      const query: BranchListQuery = parsed.data;
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "branches");
      const term = query.search.toLocaleLowerCase();
      const filtered = db.branches
        .filter((branch) => branch.clinicId === clinic.id)
        .filter(
          (branch) => !query.status || (branch.isActive ? "active" : "inactive") === query.status,
        )
        .filter(
          (branch) =>
            !term ||
            branch.nameAr.toLocaleLowerCase().includes(term) ||
            branch.nameEn.toLocaleLowerCase().includes(term),
        )
        .sort(
          (a, b) => Number(b.isActive) - Number(a.isActive) || a.nameEn.localeCompare(b.nameEn),
        );
      const start = query.cursor
        ? filtered.findIndex((branch) => branch.id === query.cursor) + 1
        : 0;
      const items = filtered.slice(start, start + query.limit);
      const last = items.at(-1);
      return {
        items,
        total: filtered.length,
        usage: usage(db, clinic.id),
        nextCursor: start + query.limit < filtered.length && last ? last.id : null,
      };
    },

    async create(persona, rawInput) {
      await delay();
      const input = validateInput(rawInput);
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "create", "branches");
      enforceLimit(db, clinic.id);
      const branch: Branch = {
        id: newId(),
        clinicId: clinic.id,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        address: input.address || null,
        phone: input.phone || null,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      db.branches.push(branch);
      audit(db, clinic.id, actorName, "branch.created", null, branch);
      persist();
      return branch;
    },

    async update(persona, branchId, rawInput) {
      await delay();
      const input = validateInput(rawInput);
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "update", "branches");
      const branch = findBranch(db, clinic.id, branchId);
      const before = { ...branch };
      Object.assign(branch, {
        ...input,
        address: input.address || null,
        phone: input.phone || null,
      });
      audit(db, clinic.id, actorName, "branch.updated", before, branch);
      persist();
      return branch;
    },

    async deactivate(persona, branchId) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "deactivate", "branches");
      const branch = findBranch(db, clinic.id, branchId);
      if (!branch.isActive) return branch;
      if (usage(db, clinic.id).active <= 1) throw new ApiError("last_active_branch");
      const before = { ...branch };
      branch.isActive = false;
      audit(db, clinic.id, actorName, "branch.deactivated", before, branch);
      persist();
      return branch;
    },

    async reactivate(persona, branchId) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "deactivate", "branches");
      const branch = findBranch(db, clinic.id, branchId);
      if (branch.isActive) return branch;
      enforceLimit(db, clinic.id);
      const before = { ...branch };
      branch.isActive = true;
      audit(db, clinic.id, actorName, "branch.reactivated", before, branch);
      persist();
      return branch;
    },
  };
}
