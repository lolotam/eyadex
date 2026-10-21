import type { Payment, PaymentMethod } from "@eyadex/contracts/finance";
import { PAYMENT_METHODS } from "@eyadex/contracts/finance";
import type { PatientMoney, ReleaseCause } from "@eyadex/contracts/settlement";
import type { MockState } from "./mock-store";

/** A receipt as stored: the patient's name is read with it, never kept on it (as the API). */
export type StoredPayment = Omit<Payment, "patientName"> & { clinicId: string };

/** Money placed on an invoice, funded by one payment or one credit (spec §4.3). */
export type StoredAllocation = {
  clinicId: string;
  id: string;
  patientId: string;
  invoiceId: string;
  paymentId: string | null;
  creditId: string | null;
  amountMinor: string;
  createdAt: string;
  by: string;
};

/** Money released from an allocation and owed back to the patient (clinic-wide credit). */
export type StoredCredit = {
  clinicId: string;
  id: string;
  patientId: string;
  originAllocationId: string;
  amountMinor: string;
  cause: ReleaseCause;
  createdAt: string;
  by: string;
};

export type PaymentMockState = {
  payments: StoredPayment[];
  allocations: StoredAllocation[];
  credits: StoredCredit[];
  /** `branchId:year` (clinic-timezone year) → the last receipt number issued there. */
  receiptCounters: Record<string, number>;
  /**
   * `clinicId:branchId` → the branch drawer's last cash position. One sequence for all time, shared by
   * cash payments and (card 2) cash refunds, as 0064's `UNIQUE (clinic_id, branch_id, cash_seq)`.
   */
  drawers: Record<string, string>;
  /** `clinicId` → the saved switches; a method with no saved switch is on. */
  methods: Record<string, Partial<Record<PaymentMethod, boolean>>>;
  /** Idempotency ledger: the first answer of a key, with the fingerprint of its request. */
  replays: Record<string, { fingerprint: string; branchId: string; answer: unknown }>;
};

export function paymentState(db: MockState): PaymentMockState {
  db.payments ??= {
    payments: [],
    allocations: [],
    credits: [],
    receiptCounters: {},
    drawers: {},
    methods: {},
    replays: {},
  };
  return db.payments;
}

/** All four switches in the fixed order; "no saved switch = on" (spec §4.6). */
export function methodsOf(db: MockState, clinicId: string) {
  const saved = paymentState(db).methods[clinicId] ?? {};
  return PAYMENT_METHODS.map((method) => ({ method, enabled: saved[method] ?? true }));
}

/** The next drawer position of a branch, as a bigint string. */
export function nextCashSeq(db: MockState, clinicId: string, branchId: string): string {
  const drawers = paymentState(db).drawers;
  const key = `${clinicId}:${branchId}`;
  const next = (BigInt(drawers[key] ?? "0") + 1n).toString();
  drawers[key] = next;
  return next;
}

/** One patient's movements in the shape the shared settlement functions read. */
export function moneyOf(db: MockState, clinicId: string, patientId: string): PatientMoney {
  const s = paymentState(db);
  const mine = <T extends { clinicId: string; patientId: string }>(rows: T[]) =>
    rows.filter((r) => r.clinicId === clinicId && r.patientId === patientId);
  return {
    payments: mine(s.payments).map((p) => ({
      id: p.id,
      invoiceId: p.invoiceId,
      amountMinor: BigInt(p.amountMinor),
    })),
    allocations: mine(s.allocations).map((a) => ({
      id: a.id,
      invoiceId: a.invoiceId,
      paymentId: a.paymentId,
      creditId: a.creditId,
      amountMinor: BigInt(a.amountMinor),
      createdAt: a.createdAt,
    })),
    credits: mine(s.credits).map((c) => ({
      id: c.id,
      originAllocationId: c.originAllocationId,
      amountMinor: BigInt(c.amountMinor),
      cause: c.cause,
      createdAt: c.createdAt,
    })),
    refunds: [],
    refundSources: [],
  };
}

let lastMovement = 0;

/**
 * The instant of a new movement: never earlier than, nor equal to, the previous one, so "newest first"
 * (F2-Q18) never falls back to comparing random ids for two writes in the same millisecond.
 */
export function movementTime(now: Date): string {
  // A caller naming an instant well in the past (a test's fixed clock) gets that instant as is.
  const at =
    now.getTime() < lastMovement - 1000 ? now.getTime() : Math.max(now.getTime(), lastMovement + 1);
  lastMovement = at;
  return new Date(at).toISOString();
}
