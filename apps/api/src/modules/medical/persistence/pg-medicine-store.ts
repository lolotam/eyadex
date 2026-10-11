import type { Medicine } from "@eyadex/contracts/medicines";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// SQL on clinic_medicines (0048). Every function runs inside the caller's withTenant(clinicId).

interface Row {
  id: string;
  name: string;
  default_dose: string | null;
  default_frequency: string | null;
  status: Medicine["status"];
}

const COLUMNS = sql`id, name, default_dose, default_frequency, status`;

const toMedicine = (row: Row): Medicine => ({
  id: row.id,
  name: row.name,
  defaultDose: row.default_dose,
  defaultFrequency: row.default_frequency,
  status: row.status,
});

/** Serialises the clinic's medicine writes, so the name check and the write see the same list. */
export async function lockClinicMedicines(tx: Tx, clinicId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`medicines:${clinicId}`}, 0))`,
  );
}

/**
 * The clinic's medicines, active first, then by name.
 *
 * @returns every medicine of the clinic
 */
export async function listClinicMedicines(tx: Tx, clinicId: string): Promise<Medicine[]> {
  const rows = await tx.execute<Row>(
    sql`SELECT ${COLUMNS} FROM clinic_medicines WHERE clinic_id = ${clinicId}
        ORDER BY status = 'active' DESC, lower(name), id`,
  );
  return rows.map(toMedicine);
}

export async function findMedicine(tx: Tx, clinicId: string, id: string): Promise<Medicine | null> {
  const rows = await tx.execute<Row>(
    sql`SELECT ${COLUMNS} FROM clinic_medicines WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
  return rows[0] === undefined ? null : toMedicine(rows[0]);
}

/** Another medicine (any status) already has this name, compared as 0048's unique index does. */
export async function medicineNameTaken(
  tx: Tx,
  clinicId: string,
  name: string,
  exceptId: string | null,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM clinic_medicines WHERE clinic_id = ${clinicId}
          AND lower(btrim(name)) = lower(btrim(${name}))
          AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
        LIMIT 1`,
  );
  return rows.length > 0;
}

export async function insertMedicine(
  tx: Tx,
  clinicId: string,
  medicine: Medicine,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO clinic_medicines (clinic_id, id, name, default_dose, default_frequency, status,
          created_at, updated_at)
        VALUES (${clinicId}, ${medicine.id}, ${medicine.name}, ${medicine.defaultDose},
          ${medicine.defaultFrequency}, ${medicine.status}, ${at}::timestamptz, ${at}::timestamptz)`,
  );
}

export async function saveMedicine(
  tx: Tx,
  clinicId: string,
  medicine: Medicine,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE clinic_medicines SET name = ${medicine.name}, default_dose = ${medicine.defaultDose},
          default_frequency = ${medicine.defaultFrequency}, status = ${medicine.status},
          updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${medicine.id}`,
  );
}
