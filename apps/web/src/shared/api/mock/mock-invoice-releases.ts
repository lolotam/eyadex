import type { CreditAuditSnapshot } from "@eyadex/contracts/finance-audit-snapshot";
import { assertFinanceAuditSnapshotShape } from "@eyadex/contracts/finance-audit-snapshot";
import { planEditRelease, planVoidRelease, type Release } from "@eyadex/contracts/settlement";
import { writeClinicAudit } from "./mock-audit";
import type { FinanceAccess } from "./mock-finance-access";
import type { StoredInvoice } from "./mock-finance-state";
import { moneyOf, movementTime, paymentState, type StoredCredit } from "./mock-payment-state";
import { settle, settlementInvoice } from "./mock-settlement";
import { newId, type MockState } from "./mock-store";

/**
 * The one F1 change of F2 (spec §4.3, `changes.ts`): an edit whose new total is below what is paid releases
 * the excess newest allocation first, a void releases every live allocation. Each release becomes a credit
 * now, so the answer read after it sees the new settlement; the returned function writes the
 * `credit.released` rows, called after the invoice's own row as the API writes them.
 *
 * @param db the state
 * @param a the actor
 * @param invoice the invoice before the change
 * @param change the new total of an edit, or "void"
 * @param now the instant of the change
 * @returns writes the audit rows of the credits
 */
export function releaseOnChange(
  db: MockState,
  a: FinanceAccess,
  invoice: StoredInvoice,
  change: bigint | "void",
  now: Date = new Date(),
): () => void {
  const money = moneyOf(db, invoice.clinicId, invoice.patientId);
  const target = settlementInvoice(invoice);
  const releases: Release[] = settle(() =>
    change === "void" ? planVoidRelease(money, target) : planEditRelease(money, target, change),
  );
  const credits: StoredCredit[] = releases.map((r) => ({
    clinicId: invoice.clinicId,
    id: newId(),
    patientId: invoice.patientId,
    originAllocationId: r.allocationId,
    amountMinor: String(r.amountMinor),
    cause: r.cause,
    createdAt: movementTime(now),
    by: a.member.id,
  }));
  paymentState(db).credits.push(...credits);
  return () => {
    for (const credit of credits) {
      const after: CreditAuditSnapshot = {
        invoiceNumber: invoice.number,
        amountMinor: credit.amountMinor,
        currency: invoice.currency,
        cause: credit.cause,
        allocationId: credit.originAllocationId,
      };
      assertFinanceAuditSnapshotShape("patient_credit", after);
      writeClinicAudit(db, {
        clinicId: a.clinic.id,
        actorName: a.actorName,
        action: "credit.released",
        entity: "patient_credit",
        entityId: credit.id,
        exact: true,
        before: null,
        after: { ...after },
      });
    }
  };
}
