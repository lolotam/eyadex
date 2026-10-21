import type { Invoice } from "@eyadex/contracts/finance";
import { readMinor } from "@eyadex/contracts/money";

const paidOf = (invoice: Pick<Invoice, "settlement">): bigint =>
  readMinor(invoice.settlement?.paidMinor ?? "0") ?? 0n;

/** Voiding an invoice something is paid on turns that money into the patient's credit (R2-2). */
export const releasesOnVoid = (invoice: Pick<Invoice, "settlement">): boolean =>
  paidOf(invoice) > 0n;

/** An edit whose new total is below what is paid turns the excess into the patient's credit (R1-5). */
export const releasesOnEdit = (
  invoice: Pick<Invoice, "settlement">,
  newTotalMinor: bigint,
): boolean => newTotalMinor < paidOf(invoice);
