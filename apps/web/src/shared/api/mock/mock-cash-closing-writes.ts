import { dayInTimeZone } from "@eyadex/contracts/audit";
import {
  createCashClosingRequestSchema,
  type CashClosingDetail,
  type CashClosingPreview,
} from "@eyadex/contracts/finance";
import {
  assertFinanceAuditSnapshotShape,
  type CashClosingAuditSnapshot,
} from "@eyadex/contracts/finance-audit-snapshot";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError, financeError } from "../api-error";
import { writeClinicAudit } from "./mock-audit";
import { closingInReach, closingsReach, requireClosings } from "./mock-cash-closing-reads";
import {
  closingPeriod,
  closingState,
  drawerMovements,
  expectedCash,
  methodTotals,
  requireCashInRange,
} from "./mock-cash-closing-state";
import type { FinanceAccess } from "./mock-finance-access";
import { clinicFinanceOf, exponentOf } from "./mock-finance-state";
import { actorReplayKey, requireIdempotencyKey } from "./mock-idempotency";
import { parse } from "./mock-medical-access";
import { newId, type MockState } from "./mock-store";

function requireBranch(db: MockState, a: FinanceAccess, branchId: string): void {
  if (!db.branches.some((b) => b.clinicId === a.clinic.id && b.id === branchId)) {
    throw new ApiError("not_found");
  }
}

/** The period, its sums and its movements as they stand now. */
function drawerNow(db: MockState, a: FinanceAccess, branchId: string) {
  const period = closingPeriod(db, a.clinic.id, branchId);
  const movements = drawerMovements(
    db,
    a.clinic.id,
    branchId,
    period.fromCashSeq,
    period.throughCashSeq,
  );
  return { period, movements, sums: expectedCash(movements) };
}

/** GET /v1/cash-closings/preview: guard → branch reach (not_found) → branch exists → range. Writes nothing. */
export function previewClosing(
  db: MockState,
  persona: Persona,
  branchId: string,
  now: Date,
): CashClosingPreview {
  const a = requireClosings(db, persona, "create");
  if (!closingsReach(a, "create", branchId)) throw new ApiError("not_found");
  requireBranch(db, a, branchId);
  const { period, movements, sums } = drawerNow(db, a, branchId);
  requireCashInRange(sums);
  const businessDate = dayInTimeZone(now.toISOString(), a.clinic.timezone);
  const currency = clinicFinanceOf(db, a.clinic.id).currency;
  return {
    branchId,
    businessDate,
    previousClosingId: period.previousClosingId,
    fromCashSeq: String(period.fromCashSeq),
    throughCashSeq: String(period.throughCashSeq),
    cashInMinor: String(sums.cashIn),
    cashOutMinor: String(sums.cashOut),
    expectedMinor: String(sums.expected),
    methodTotals: methodTotals(db, a.clinic.id, branchId, businessDate),
    movements,
    currency,
    currencyExponent: exponentOf(currency),
  };
}

/**
 * POST /v1/cash-closings, refusing in the API's order: guard → body → key → branch reach → replay
 * (idempotency_conflict) → branch exists → cash_drawer_changed → cash_closing_exists (same business
 * day) → range → closing_note_required. A refused closing writes nothing.
 */
export function closeCash(
  db: MockState,
  persona: Persona,
  raw: unknown,
  key: string,
  now: Date,
): CashClosingDetail {
  const a = requireClosings(db, persona, "create");
  const body = parse(createCashClosingRequestSchema, raw);
  requireIdempotencyKey(key);
  if (!closingsReach(a, "create", body.branchId)) throw new ApiError("not_found");
  const s = closingState(db);
  const ledger = `cash_closing:${actorReplayKey(a.clinic.id, a.member.id, key)}`;
  const fingerprint = JSON.stringify(body);
  const prior = s.replays[ledger];
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
    return closingInReach(db, a, "create", prior.closingId);
  }
  requireBranch(db, a, body.branchId);
  const { period, sums } = drawerNow(db, a, body.branchId);
  if (
    body.previousClosingId !== period.previousClosingId ||
    BigInt(body.throughCashSeq) !== period.throughCashSeq
  ) {
    throw financeError("cash_drawer_changed");
  }
  const businessDate = dayInTimeZone(now.toISOString(), a.clinic.timezone);
  const last = s.closings.find(
    (k) => k.clinicId === a.clinic.id && k.id === period.previousClosingId,
  );
  if (last?.businessDate === businessDate) throw financeError("cash_closing_exists");
  requireCashInRange(sums);
  const note = body.note ?? null;
  const counted = BigInt(body.countedMinor);
  if (counted !== sums.expected && (note === null || note.trim() === "")) {
    throw financeError("closing_note_required");
  }
  const currency = clinicFinanceOf(db, a.clinic.id).currency;
  const id = newId();
  s.closings.push({
    clinicId: a.clinic.id,
    id,
    branchId: body.branchId,
    businessDate,
    previousClosingId: period.previousClosingId,
    fromCashSeq: String(period.fromCashSeq),
    toCashSeq: String(period.throughCashSeq),
    expectedMinor: String(sums.expected),
    countedMinor: body.countedMinor,
    differenceMinor: String(counted - sums.expected),
    methodTotals: methodTotals(db, a.clinic.id, body.branchId, businessDate),
    note,
    currency,
    currencyExponent: exponentOf(currency),
    closedBy: a.member.id,
    closedAt: now.toISOString(),
  });
  s.marks[`${a.clinic.id}:${body.branchId}`] = {
    lastClosingId: id,
    lastClosedSeq: String(period.throughCashSeq),
  };
  // F2-Q19: administrative, out of the platform's view; the note goes in as its length only.
  const after: CashClosingAuditSnapshot = {
    businessDate,
    fromCashSeq: String(period.fromCashSeq),
    toCashSeq: String(period.throughCashSeq),
    expectedMinor: String(sums.expected),
    countedMinor: body.countedMinor,
    differenceMinor: String(counted - sums.expected),
    currency,
    previousClosingId: period.previousClosingId,
    ...(note === null ? {} : { noteLength: note.length }),
  };
  assertFinanceAuditSnapshotShape("cash_closing", after);
  writeClinicAudit(db, {
    clinicId: a.clinic.id,
    actorName: a.actorName,
    action: "cash_closing.closed",
    entity: "cash_closing",
    entityId: id,
    exact: true,
    before: null,
    after: { ...after },
  });
  s.replays[ledger] = { fingerprint, closingId: id };
  return closingInReach(db, a, "create", id);
}
