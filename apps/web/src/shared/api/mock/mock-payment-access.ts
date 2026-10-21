import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import { guardFinance, type FinanceAccess } from "./mock-finance-access";
import { financeState, type StoredInvoice } from "./mock-finance-state";
import { actorReplayKey } from "./mock-idempotency";
import { paymentState } from "./mock-payment-state";
import type { MockState } from "./mock-store";

// The API's payment guards (finance spec §4.6), in CLAUDE.md §6 order: active user → clinic access →
// finance module → a `payments` key of the route in any scope; the record's branch is judged later, as
// `not_found`, once the invoice is known. `payments` has no `own` scope (§4.1).

export type PaymentAction = "view" | "create";

const holds = (a: FinanceAccess, action: PaymentAction) =>
  a.keys.includes(`${action}:payments:clinic`) || a.keys.includes(`${action}:payments:branch`);

/** Does the caller's `payments` key reach this branch: the clinic key, or a branch key naming it (F2-Q8). */
export function paymentsReach(a: FinanceAccess, action: PaymentAction, branchId: string): boolean {
  if (a.keys.includes(`${action}:payments:clinic`)) return true;
  if (!a.keys.includes(`${action}:payments:branch`)) return false;
  return a.branches.allBranches || a.branches.branchIds.includes(branchId);
}

/** The guard plus a key of the route in any scope, else forbidden. */
export function requirePayments(db: MockState, persona: Persona, action: PaymentAction) {
  const a = guardFinance(db, persona);
  if (!holds(a, action)) throw new ApiError("forbidden");
  return a;
}

/** The invoice a payment route names: unknown, or its branch outside the key's reach, is not_found. */
export function reachableInvoice(
  db: MockState,
  a: FinanceAccess,
  invoiceId: string,
  action: PaymentAction,
): StoredInvoice {
  const invoice = financeState(db).invoices.find(
    (i) => i.id === invoiceId && i.clinicId === a.clinic.id,
  );
  if (!invoice || !paymentsReach(a, action, invoice.branchId)) throw new ApiError("not_found");
  return invoice;
}

type Replay = { op: "payment" | "credit"; key: string; invoiceId: string; body: unknown };

const ledgerKey = (a: FinanceAccess, r: Replay) =>
  `${r.op}:${actorReplayKey(a.clinic.id, a.member.id, r.key)}`;
const fingerprintOf = (r: Replay) =>
  JSON.stringify({ op: r.op, invoiceId: r.invoiceId, body: r.body });

/**
 * Lesson 2.3: the first answer of a key, given again only for the same operation, invoice and body (else
 * idempotency_conflict) and only while its branch is still in the caller's reach (else not_found).
 */
export function replayOf<T>(db: MockState, a: FinanceAccess, r: Replay): T | undefined {
  const prior = paymentState(db).replays[ledgerKey(a, r)];
  if (!prior) return undefined;
  if (prior.fingerprint !== fingerprintOf(r)) throw new ApiError("idempotency_conflict");
  if (!paymentsReach(a, "create", prior.branchId)) throw new ApiError("not_found");
  return structuredClone(prior.answer) as T;
}

export function rememberReplay(
  db: MockState,
  a: FinanceAccess,
  r: Replay,
  branchId: string,
  answer: unknown,
): void {
  paymentState(db).replays[ledgerKey(a, r)] = {
    fingerprint: fingerprintOf(r),
    branchId,
    answer: structuredClone(answer),
  };
}
