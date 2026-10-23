import {
  cashClosingListQuerySchema,
  type CashClosingDetail,
} from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import type { CashClosingList } from "../cash-closings-client";
import { drawerMovements, closingState, type StoredClosing } from "./mock-cash-closing-state";
import { guardFinance, type FinanceAccess } from "./mock-finance-access";
import { fromCursor, toCursor } from "./mock-list-cursor";
import { parse } from "./mock-medical-access";
import type { MockState } from "./mock-store";

// The API's closing guards (spec §4.6), in CLAUDE.md §6 order: active user → clinic access → finance
// module → a `cash_closings` key of the route in any scope; the branch is judged later, as not_found.

export type ClosingAction = "view" | "create";

/** Does the caller's `cash_closings` key reach this branch: the clinic key, or a branch key naming it. */
export function closingsReach(a: FinanceAccess, action: ClosingAction, branchId: string): boolean {
  if (a.keys.includes(`${action}:cash_closings:clinic`)) return true;
  if (!a.keys.includes(`${action}:cash_closings:branch`)) return false;
  return a.branches.allBranches || a.branches.branchIds.includes(branchId);
}

export function requireClosings(db: MockState, persona: Persona, action: ClosingAction) {
  const a = guardFinance(db, persona);
  const holds =
    a.keys.includes(`${action}:cash_closings:clinic`) ||
    a.keys.includes(`${action}:cash_closings:branch`);
  if (!holds) throw new ApiError("forbidden");
  return a;
}

const view = ({ clinicId: _clinic, ...closing }: StoredClosing) => structuredClone(closing);

/** A closing with its period's cash movements; one outside the reach is not_found (closing-view.ts). */
export function closingInReach(
  db: MockState,
  a: FinanceAccess,
  action: ClosingAction,
  closingId: string,
): CashClosingDetail {
  const closing = closingState(db).closings.find(
    (k) => k.clinicId === a.clinic.id && k.id === closingId,
  );
  if (!closing || !closingsReach(a, action, closing.branchId)) throw new ApiError("not_found");
  const movements = drawerMovements(
    db,
    a.clinic.id,
    closing.branchId,
    BigInt(closing.fromCashSeq),
    BigInt(closing.toCashSeq),
  );
  return { ...view(closing), movements };
}

/** GET /v1/cash-closings: newest first, inside the view key's reach; no patient on a closing. */
export function listClosings(db: MockState, persona: Persona, raw: unknown): CashClosingList {
  const a = requireClosings(db, persona, "view");
  const q = parse(cashClosingListQuerySchema, raw);
  const after = q.cursor ? fromCursor(q.cursor) : null;
  const rows = closingState(db)
    .closings.filter(
      (k) =>
        k.clinicId === a.clinic.id &&
        closingsReach(a, "view", k.branchId) &&
        (!q.branchId || k.branchId === q.branchId) &&
        (!q.from || k.businessDate >= q.from) &&
        (!q.to || k.businessDate <= q.to),
    )
    // Mock ids are random, so the closing instant orders them, as UUID v7 order does in the API.
    .sort((x, y) => y.closedAt.localeCompare(x.closedAt) || y.id.localeCompare(x.id));
  const rest = after ? rows.slice(rows.findIndex((k) => k.id === after) + 1 || rows.length) : rows;
  const page = rest.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(view),
    nextCursor: rest.length > q.limit && last ? toCursor(last.id) : null,
    total: rows.length,
  };
}

/** GET /v1/cash-closings/:id. */
export function getClosing(db: MockState, persona: Persona, closingId: string): CashClosingDetail {
  const a = requireClosings(db, persona, "view");
  return closingInReach(db, a, "view", closingId);
}
