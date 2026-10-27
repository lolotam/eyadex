import { randomUUID } from "node:crypto";
import { owner, type World } from "./export-fixtures.ts";
import { insertBranch } from "./export-prepare-fixtures.ts";

/** Synthetic SQL fixtures only. Runtime queries still execute as eyadex_app. */
export function reportData(world: World, own = false) {
  const branchId = insertBranch(world.clinicId, true);
  const patientId = randomUUID();
  const invoiceId = randomUUID();
  const visitId = randomUUID();
  owner(`INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender,
    registration_branch_id, status, created_at, updated_at)
    VALUES ('${world.clinicId}', '${patientId}', '1', '=Synthetic patient', '${patientId}', '2000-01-01',
      'female', '${branchId}', 'active', clock_timestamp(), clock_timestamp());
    INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source,
      issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor,
      total_minor, created_by, created_at, updated_at)
    VALUES ('${world.clinicId}', '${invoiceId}', '${branchId}', '${patientId}', 2026, 1, 'TEST-2026-1',
      'issued', 'manual', '2026-01-12T09:00:00Z', 'KWD', 3, 12500, 0, 0, 0, 12500,
      '${world.userId}', clock_timestamp(), clock_timestamp());
    INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, provider_id, description_ar,
      description_en, quantity, unit_price_minor, line_total_minor, created_at, updated_at)
    VALUES ('${world.clinicId}', '${randomUUID()}', '${invoiceId}', 0, 'free', '${world.membershipId}',
      'Sample', 'Sample', 1, 12500, 12500, clock_timestamp(), clock_timestamp());`);
  if (own)
    owner(`INSERT INTO visits (clinic_id, id, branch_id, patient_id, provider_membership_id,
      status, started_at, created_at, updated_at)
    VALUES ('${world.clinicId}', '${visitId}', '${branchId}', '${patientId}', '${world.membershipId}',
      'draft', clock_timestamp(), clock_timestamp(), clock_timestamp())`);
  return { branchId, patientId, invoiceId, visitId };
}
