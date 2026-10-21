import type { Invoice } from "@eyadex/contracts/finance";
import { ApiError } from "../api-error";
import type { StoredInvoice } from "./mock-finance-state";
import { settlementOf } from "./mock-settlement";
import type { MockState } from "./mock-store";

/** The invoice as the API answers it: without its clinic, with its branch's current names. */
export function strip(db: MockState, invoice: StoredInvoice): Invoice {
  const { clinicId, ...rest } = invoice;
  const branch = db.branches.find((b) => b.id === invoice.branchId && b.clinicId === clinicId);
  if (!branch) throw new ApiError("not_found");
  return {
    ...rest,
    branchNameAr: branch.nameAr,
    branchNameEn: branch.nameEn,
    settlement: settlementOf(db, invoice),
  };
}
