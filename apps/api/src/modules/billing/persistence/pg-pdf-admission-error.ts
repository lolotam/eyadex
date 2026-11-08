import { asDatabaseError, DatabaseError } from "@eyadex/db";

// A savepoint rethrows the original error. Use the same sanitizer as the outer wrapper.
export function pdfAdmissionQuota(error: unknown): boolean {
  const failure = asDatabaseError(error);
  if (!(failure instanceof DatabaseError)) return false;
  return (
    (failure.code === "23514" && failure.constraint === "invoice_pdf_capacity_admitted_check") ||
    (failure.code === "23505" && failure.constraint === "invoice_pdf_clinic_capacity")
  );
}
