// The settlement model of finance spec §4.3: money is a set of movements and every balance is derived
// from them, never stored. These functions are the same in the API, in the web mock and on the receipt.

/** An invoice as the settlement sees it: its id, whether it was voided and its total in minor units. */
export interface SettlementInvoice {
  readonly id: string;
  readonly status: "issued" | "void";
  readonly totalMinor: bigint;
}

/** Money in: a receipt placed on one invoice. */
export interface SettlementPayment {
  readonly id: string;
  readonly invoiceId: string;
  readonly amountMinor: bigint;
}

/** Money placed on an invoice, funded by exactly one payment or one credit. */
export interface SettlementAllocation {
  readonly id: string;
  readonly invoiceId: string;
  readonly paymentId: string | null;
  readonly creditId: string | null;
  readonly amountMinor: bigint;
  /** An ISO-8601 instant; any fractional precision up to nanoseconds and any offset. */
  readonly createdAt: string;
}

/** Why money left an allocation: the invoice changed, was voided, or the payment was refunded. */
export type ReleaseCause = "invoice_edited" | "invoice_voided" | "refund";

/** Money released from an allocation and owed back to the patient. */
export interface SettlementCredit {
  readonly id: string;
  readonly originAllocationId: string;
  readonly amountMinor: bigint;
  readonly cause: ReleaseCause;
  /** An ISO-8601 instant; any fractional precision up to nanoseconds and any offset. */
  readonly createdAt: string;
}

/** Money out: a refund. */
export interface SettlementRefund {
  readonly id: string;
  readonly amountMinor: bigint;
}

/** Which credits a refund spent. */
export interface SettlementRefundSource {
  readonly refundId: string;
  readonly creditId: string;
  readonly amountMinor: bigint;
}

/** One patient's money: every movement that belongs to them. */
export interface PatientMoney {
  readonly payments: readonly SettlementPayment[];
  readonly allocations: readonly SettlementAllocation[];
  readonly credits: readonly SettlementCredit[];
  readonly refunds: readonly SettlementRefund[];
  readonly refundSources: readonly SettlementRefundSource[];
}

/** The derived state of an issued invoice; a void invoice has none. */
export type SettlementState = "unpaid" | "partly_paid" | "paid";

/** What an issued invoice holds: its state and the two amounts behind it. */
export interface SettlementSummary {
  readonly state: SettlementState;
  readonly paidMinor: bigint;
  readonly owedMinor: bigint;
}

/** A broken money invariant, named as 0066's `finance_check_patient` names it. */
export type SettlementBreach =
  | "allocation_live"
  | "credit_remaining"
  | "payment_allocated"
  | "payment_released"
  | "invoice_paid"
  | "refund_sources"
  | "conservation";

/** The credits released from one allocation, the amount that shrinks it. */
function releasedFrom(money: PatientMoney, allocationId: string): bigint {
  return money.credits
    .filter((credit) => credit.originAllocationId === allocationId)
    .reduce((sum, credit) => sum + credit.amountMinor, 0n);
}

/**
 * What is still live on an allocation: its amount minus the credits released from it.
 *
 * @param money the patient's movements
 * @param allocationId the allocation
 * @returns the live amount, or zero for an allocation the patient does not hold
 */
export function allocationLive(money: PatientMoney, allocationId: string): bigint {
  const allocation = money.allocations.find((row) => row.id === allocationId);
  if (allocation === undefined) return 0n;
  return allocation.amountMinor - releasedFrom(money, allocationId);
}

/**
 * What an invoice holds: the live amount of every allocation placed on it.
 *
 * @param money the patient's movements
 * @param invoiceId the invoice
 * @returns the paid amount in minor units
 */
export function invoicePaid(money: PatientMoney, invoiceId: string): bigint {
  return money.allocations
    .filter((allocation) => allocation.invoiceId === invoiceId)
    .reduce((sum, allocation) => sum + allocationLive(money, allocation.id), 0n);
}

/**
 * The derived state of an invoice: what is paid, what is owed and the state behind them (spec §4.3).
 *
 * @param money the patient's movements
 * @param invoice the invoice
 * @returns the summary, or null for a void invoice, which has no state
 */
export function invoiceSettlement(
  money: PatientMoney,
  invoice: SettlementInvoice,
): SettlementSummary | null {
  if (invoice.status === "void") return null;
  const paidMinor = invoicePaid(money, invoice.id);
  const owedMinor = invoice.totalMinor - paidMinor;
  const state: SettlementState =
    owedMinor === 0n ? "paid" : paidMinor === 0n ? "unpaid" : "partly_paid";
  return { state, paidMinor, owedMinor };
}

/**
 * What is still left of a credit: its amount minus the allocations it funded and the refunds it paid for.
 *
 * @param money the patient's movements
 * @param creditId the credit
 * @returns the remaining amount, or zero for a credit the patient does not hold
 */
export function creditRemaining(money: PatientMoney, creditId: string): bigint {
  const credit = money.credits.find((row) => row.id === creditId);
  if (credit === undefined) return 0n;
  const spent = money.allocations
    .filter((allocation) => allocation.creditId === creditId)
    .reduce((sum, allocation) => sum + allocation.amountMinor, 0n);
  const refunded = money.refundSources
    .filter((source) => source.creditId === creditId)
    .reduce((sum, source) => sum + source.amountMinor, 0n);
  return credit.amountMinor - spent - refunded;
}

/**
 * The patient's credit balance: what is owed back to them across every credit (R1-4, §8d item 9).
 *
 * @param money the patient's movements
 * @returns the balance in minor units
 */
export function creditBalance(money: PatientMoney): bigint {
  return money.credits.reduce((sum, credit) => sum + creditRemaining(money, credit.id), 0n);
}

/**
 * What may still be refunded from a payment: the live amount of its allocations (issue #91).
 *
 * @param money the patient's movements
 * @param paymentId the payment
 * @returns the refundable amount in minor units
 */
export function paymentRefundable(money: PatientMoney, paymentId: string): bigint {
  return money.allocations
    .filter((allocation) => allocation.paymentId === paymentId)
    .reduce((sum, allocation) => sum + allocationLive(money, allocation.id), 0n);
}

/** What a payment placed: the sum of its allocations. */
function allocatedTotal(money: PatientMoney, paymentId: string): bigint {
  return money.allocations
    .filter((allocation) => allocation.paymentId === paymentId)
    .reduce((sum, allocation) => sum + allocation.amountMinor, 0n);
}

/** The credits released from the allocations of a payment. */
function releasedFromPayment(money: PatientMoney, paymentId: string): bigint {
  return money.allocations
    .filter((allocation) => allocation.paymentId === paymentId)
    .reduce((sum, allocation) => sum + releasedFrom(money, allocation.id), 0n);
}

/** The credits a refund spent. */
function sourcedTotal(money: PatientMoney, refundId: string): bigint {
  return money.refundSources
    .filter((source) => source.refundId === refundId)
    .reduce((sum, source) => sum + source.amountMinor, 0n);
}

/** An issued invoice holds at most its total; a void one holds nothing. */
function invoiceBreached(money: PatientMoney, invoice: SettlementInvoice): boolean {
  const paid = invoicePaid(money, invoice.id);
  if (invoice.status === "void") return paid !== 0n;
  return paid > invoice.totalMinor;
}

/** Σ payments = Σ paid(i) + Σ remaining(c) + Σ refunds, the way 0066 line 160 writes it. */
function conserved(money: PatientMoney): boolean {
  const received = money.payments.reduce((sum, payment) => sum + payment.amountMinor, 0n);
  const placed = money.allocations.reduce((sum, row) => sum + row.amountMinor, 0n);
  const released = money.credits.reduce((sum, credit) => sum + credit.amountMinor, 0n);
  const spent = money.allocations
    .filter((allocation) => allocation.creditId !== null)
    .reduce((sum, allocation) => sum + allocation.amountMinor, 0n);
  const sourced = money.refundSources.reduce((sum, source) => sum + source.amountMinor, 0n);
  const refunded = money.refunds.reduce((sum, row) => sum + row.amountMinor, 0n);
  return received === placed - released + (released - spent - sourced) + refunded;
}

/**
 * The money invariants of §4.3, in the order 0066's `finance_check_patient` checks them, so the code and
 * the database refuse the same states. Every breach is named once.
 *
 * @param money the patient's movements
 * @param invoices the invoices the money sits on
 * @returns the broken invariants, empty when the money is sound
 */
export function settlementBreaches(
  money: PatientMoney,
  invoices: readonly SettlementInvoice[],
): SettlementBreach[] {
  const breaches: SettlementBreach[] = [];
  if (money.allocations.some((row) => allocationLive(money, row.id) < 0n)) {
    breaches.push("allocation_live");
  }
  if (money.credits.some((credit) => creditRemaining(money, credit.id) < 0n)) {
    breaches.push("credit_remaining");
  }
  if (money.payments.some((payment) => payment.amountMinor !== allocatedTotal(money, payment.id))) {
    breaches.push("payment_allocated");
  }
  if (
    money.payments.some((payment) => payment.amountMinor < releasedFromPayment(money, payment.id))
  ) {
    breaches.push("payment_released");
  }
  if (invoices.some((invoice) => invoiceBreached(money, invoice))) {
    breaches.push("invoice_paid");
  }
  if (money.refunds.some((refund) => refund.amountMinor !== sourcedTotal(money, refund.id))) {
    breaches.push("refund_sources");
  }
  if (!conserved(money)) {
    breaches.push("conservation");
  }
  return breaches;
}
