import { refundListQuerySchema, type Refund } from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import type { RefundList } from "../payments-client";
import { parse } from "./mock-medical-access";
import { paymentsReach, requirePayments } from "./mock-payment-access";
import { paymentState, type StoredRefund } from "./mock-payment-state";
import type { MockState } from "./mock-store";

/** The refund as the API answers it, with the patient's display name read beside it (no file open). */
export function refundView(db: MockState, r: StoredRefund): Refund {
  const { clinicId, ...rest } = r;
  const patient = db.patients.find((x) => x.clinicId === clinicId && x.id === r.patientId);
  if (!patient) throw new ApiError("unknown");
  return { ...rest, patientName: patient.fullName };
}

// The API's list cursor (list-cursor.ts): the last id without its dashes; anything else is refused.
const toCursor = (id: string) => id.replaceAll("-", "");
function fromCursor(cursor: string): string {
  if (!/^[0-9a-f]{32}$/.test(cursor)) throw new ApiError("validation");
  const at = [8, 12, 16, 20];
  return [0, ...at].map((start, i) => cursor.slice(start, at[i])).join("-");
}

/** GET /v1/refunds: read through `view:payments` (spec §4.1), newest first, inside its reach. */
export function listRefunds(db: MockState, persona: Persona, raw: unknown): RefundList {
  const a = requirePayments(db, persona, "view");
  const q = parse(refundListQuerySchema, raw);
  const after = q.cursor ? fromCursor(q.cursor) : null;
  const rows = paymentState(db)
    .refunds.filter(
      (r) =>
        r.clinicId === a.clinic.id &&
        paymentsReach(a, "view", r.branchId) &&
        (!q.branchId || r.branchId === q.branchId) &&
        (!q.method || r.method === q.method) &&
        (!q.patientId || r.patientId === q.patientId) &&
        (!q.invoiceId || r.invoiceId === q.invoiceId) &&
        (!q.from || r.businessDate >= q.from) &&
        (!q.to || r.businessDate <= q.to),
    )
    // Mock ids are random, so the creation instant orders them, as UUID v7 order does in the API.
    .sort((x, y) => y.refundedAt.localeCompare(x.refundedAt) || y.id.localeCompare(x.id));
  const rest = after ? rows.slice(rows.findIndex((r) => r.id === after) + 1 || rows.length) : rows;
  const page = rest.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => refundView(db, r)),
    nextCursor: rest.length > q.limit && last ? toCursor(last.id) : null,
    total: rows.length,
  };
}

/** GET /v1/refunds/:id: a refund outside the view key's reach is not_found. */
export function getRefund(db: MockState, persona: Persona, refundId: string): Refund {
  const a = requirePayments(db, persona, "view");
  const r = paymentState(db).refunds.find((x) => x.id === refundId && x.clinicId === a.clinic.id);
  if (!r || !paymentsReach(a, "view", r.branchId)) throw new ApiError("not_found");
  return refundView(db, r);
}
