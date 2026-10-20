// What every money operation writes (finance spec §4.3 "Operations"). A plan only reads the movements and
// returns what to write; the use case writes it in one transaction under the locks of §4.4.

import {
  allocationLive,
  creditBalance,
  creditRemaining,
  invoicePaid,
  type PatientMoney,
  type ReleaseCause,
  type SettlementAllocation,
  type SettlementInvoice,
} from "./settlement-balances.ts";
import { newestFirst, oldestFirst } from "./settlement-order.ts";

/** Why a money operation was refused; the API answers each code with its own message. */
export type SettlementErrorCode =
  | "invalid_amount"
  | "invoice_void"
  | "invoice_settled"
  | "payment_exceeds_balance"
  | "credit_insufficient"
  | "refund_exceeds_available";

/** A rule of the settlement was broken; the API answers it as `validation` or as its own code. */
export class SettlementError extends Error {
  constructor(readonly code: SettlementErrorCode) {
    super(code);
    this.name = "SettlementError";
  }
}

/** Money to release from one allocation into a credit. */
export interface Release {
  readonly allocationId: string;
  readonly amountMinor: bigint;
  readonly cause: ReleaseCause;
}

/** Credit to spend, oldest credit first. */
export interface CreditSpend {
  readonly creditId: string;
  readonly amountMinor: bigint;
}

/** What an invoice still owes: its total minus what is paid on it. */
function owedOn(money: PatientMoney, invoice: SettlementInvoice): bigint {
  return invoice.totalMinor - invoicePaid(money, invoice.id);
}

/** The smaller of two amounts. */
function smaller(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * Releases money from allocations newest first (F2-Q18): the live part of each allocation, up to what is
 * still to release, and an allocation nothing is left of is skipped.
 *
 * @param money the patient's movements
 * @param allocations the allocations the money may leave from
 * @param amountMinor how much to release
 * @param cause why the money leaves the invoice
 * @returns the releases to write, newest allocation first
 */
function releaseNewestFirst(
  money: PatientMoney,
  allocations: readonly SettlementAllocation[],
  amountMinor: bigint,
  cause: ReleaseCause,
): Release[] {
  const releases: Release[] = [];
  let remaining = amountMinor;
  for (const allocation of newestFirst(allocations)) {
    if (remaining <= 0n) break;
    const live = allocationLive(money, allocation.id);
    if (live <= 0n) continue;
    const take = smaller(live, remaining);
    releases.push({ allocationId: allocation.id, amountMinor: take, cause });
    remaining -= take;
  }
  return releases;
}

/**
 * Spends credits oldest first, skipping the ones nothing is left of (F2-Q18).
 *
 * @param money the patient's movements
 * @param amountMinor the amount to spend
 * @returns the credits to spend and how much of each
 */
function spendCredits(money: PatientMoney, amountMinor: bigint): CreditSpend[] {
  const spends: CreditSpend[] = [];
  let remaining = amountMinor;
  for (const credit of oldestFirst(money.credits)) {
    if (remaining <= 0n) break;
    const available = creditRemaining(money, credit.id);
    if (available <= 0n) continue;
    const take = smaller(available, remaining);
    spends.push({ creditId: credit.id, amountMinor: take });
    remaining -= take;
  }
  return spends;
}

/**
 * The plan of a payment: money in against one invoice, in one allocation of the whole amount (F2-Q1).
 *
 * @param money the patient's movements
 * @param invoice the invoice the payment names
 * @param amountMinor the amount received
 * @returns the allocation to write
 * @throws SettlementError when the invoice is void, settled, or the amount is above what it owes
 */
export function planPayment(
  money: PatientMoney,
  invoice: SettlementInvoice,
  amountMinor: bigint,
): { allocationMinor: bigint } {
  if (amountMinor <= 0n) throw new SettlementError("invalid_amount");
  if (invoice.status === "void") throw new SettlementError("invoice_void");
  const owed = owedOn(money, invoice);
  if (owed === 0n) throw new SettlementError("invoice_settled");
  if (amountMinor > owed) throw new SettlementError("payment_exceeds_balance");
  return { allocationMinor: amountMinor };
}

/**
 * The plan of applying the patient's credit to an invoice: no receipt, no money came in (F2-Q6).
 *
 * @param money the patient's movements
 * @param invoice the invoice the credit is applied to
 * @param amountMinor the amount to apply
 * @returns the credits to spend, oldest first
 * @throws SettlementError when the invoice is void, settled, or the amount is above the owed or the
 *   balance
 */
export function planCreditApplication(
  money: PatientMoney,
  invoice: SettlementInvoice,
  amountMinor: bigint,
): CreditSpend[] {
  if (amountMinor <= 0n) throw new SettlementError("invalid_amount");
  if (invoice.status === "void") throw new SettlementError("invoice_void");
  const owed = owedOn(money, invoice);
  if (owed === 0n) throw new SettlementError("invoice_settled");
  if (amountMinor > owed) throw new SettlementError("payment_exceeds_balance");
  if (amountMinor > creditBalance(money)) throw new SettlementError("credit_insufficient");
  return spendCredits(money, amountMinor);
}

/**
 * The plan of an edit that lowers the invoice total: the excess leaves the invoice into the patient's
 * credit, newest allocation first (R1-5, F2-Q18). Raising the total only raises what is owed; it
 * never takes a credit back.
 *
 * @param money the patient's movements
 * @param invoice the edited invoice
 * @param newTotalMinor the new total
 * @returns the releases to write, empty when the total did not drop below what is paid
 * @throws SettlementError when the invoice is void or the new total is negative
 */
export function planEditRelease(
  money: PatientMoney,
  invoice: SettlementInvoice,
  newTotalMinor: bigint,
): Release[] {
  if (newTotalMinor < 0n) throw new SettlementError("invalid_amount");
  if (invoice.status === "void") throw new SettlementError("invoice_void");
  const excess = invoicePaid(money, invoice.id) - newTotalMinor;
  if (excess <= 0n) return [];
  const allocations = money.allocations.filter((allocation) => allocation.invoiceId === invoice.id);
  return releaseNewestFirst(money, allocations, excess, "invoice_edited");
}

/**
 * The plan of voiding the invoice: every allocation that still holds money releases it, newest first
 * (R2-2). Only what is live is released, so money already refunded is never released twice, and a credit
 * spent on another invoice is never touched.
 *
 * @param money the patient's movements
 * @param invoice the voided invoice
 * @returns the releases to write
 * @throws SettlementError when the invoice is already void
 */
export function planVoidRelease(money: PatientMoney, invoice: SettlementInvoice): Release[] {
  if (invoice.status === "void") throw new SettlementError("invoice_void");
  const releases: Release[] = [];
  for (const allocation of newestFirst(money.allocations)) {
    if (allocation.invoiceId !== invoice.id) continue;
    const live = allocationLive(money, allocation.id);
    if (live <= 0n) continue;
    releases.push({ allocationId: allocation.id, amountMinor: live, cause: "invoice_voided" });
  }
  return releases;
}

/**
 * The plan of refunding from a payment: the payment's live allocations on this invoice release the amount,
 * newest first, and the invoice owes it again (FIN-14). The caller writes one credit per release and one
 * refund source of the same amount per credit, so every refund spends credit and money is never released
 * twice.
 *
 * @param money the patient's movements
 * @param invoiceId the invoice the refund was made from
 * @param paymentId the payment to refund from
 * @param amountMinor the amount to refund
 * @returns the releases to write
 * @throws SettlementError when the amount is not positive or is above what the payment still holds there
 */
export function planPaymentRefund(
  money: PatientMoney,
  invoiceId: string,
  paymentId: string,
  amountMinor: bigint,
): Release[] {
  if (amountMinor <= 0n) throw new SettlementError("invalid_amount");
  const allocations = money.allocations.filter(
    (allocation) => allocation.paymentId === paymentId && allocation.invoiceId === invoiceId,
  );
  const available = allocations.reduce(
    (sum, allocation) => sum + allocationLive(money, allocation.id),
    0n,
  );
  if (amountMinor > available) throw new SettlementError("refund_exceeds_available");
  return releaseNewestFirst(money, allocations, amountMinor, "refund");
}

/**
 * The plan of refunding from the patient's credit: the credits are spent oldest first through the refund
 * sources. A credit refund works on a void invoice too, for the credit the void released (§4.6).
 *
 * @param money the patient's movements
 * @param amountMinor the amount to refund
 * @returns the credits to spend, oldest first
 * @throws SettlementError when the amount is not positive or is above the credit balance
 */
export function planCreditRefund(money: PatientMoney, amountMinor: bigint): CreditSpend[] {
  if (amountMinor <= 0n) throw new SettlementError("invalid_amount");
  if (amountMinor > creditBalance(money)) throw new SettlementError("credit_insufficient");
  return spendCredits(money, amountMinor);
}
