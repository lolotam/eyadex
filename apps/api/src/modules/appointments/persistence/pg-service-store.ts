import type { ClinicService, ServiceStatus } from "@eyadex/contracts/services";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { ServiceFields, ServiceRecord } from "../domain/service-rules.ts";

// SQL on clinic_services (0042). Every function runs inside the caller's withTenant(clinicId).

interface Row {
  id: string;
  name_ar: string;
  name_en: string;
  duration_minutes: number;
  status: ServiceStatus;
  created_at: Date | string;
}

export const SERVICE_COLUMNS = sql`id, name_ar, name_en, duration_minutes, status, created_at`;

export const toClinicService = (row: Row): ClinicService => ({
  id: row.id,
  nameAr: row.name_ar,
  nameEn: row.name_en,
  durationMinutes: Number(row.duration_minutes),
  status: row.status,
  createdAt: new Date(row.created_at).toISOString(),
});

/** Serialises the clinic's service writes, so the name check and the insert see the same list. */
export async function lockClinicServices(tx: Tx, clinicId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`services:${clinicId}`}, 0))`,
  );
}

export async function findService(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<ClinicService | null> {
  const rows = await tx.execute<Row>(
    sql`SELECT ${SERVICE_COLUMNS} FROM clinic_services WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
  return rows[0] === undefined ? null : toClinicService(rows[0]);
}

/** Another service (any status) already uses either name, compared as 0042's unique indexes do. */
export async function serviceNameTaken(
  tx: Tx,
  clinicId: string,
  input: ServiceFields,
  exceptId: string | null,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM clinic_services WHERE clinic_id = ${clinicId}
          AND (lower(btrim(name_ar)) = lower(btrim(${input.nameAr}))
               OR lower(btrim(name_en)) = lower(btrim(${input.nameEn})))
          AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
        LIMIT 1`,
  );
  return rows.length > 0;
}

export async function insertService(
  tx: Tx,
  clinicId: string,
  service: ServiceRecord,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO clinic_services (clinic_id, id, name_ar, name_en, duration_minutes, status,
          created_at, updated_at)
        VALUES (${clinicId}, ${service.id}, ${service.nameAr}, ${service.nameEn},
          ${service.durationMinutes}, ${service.status}, ${at}::timestamptz, ${at}::timestamptz)`,
  );
}

export async function saveService(
  tx: Tx,
  clinicId: string,
  service: ServiceRecord,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE clinic_services SET name_ar = ${service.nameAr}, name_en = ${service.nameEn},
          duration_minutes = ${service.durationMinutes}, status = ${service.status},
          updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${service.id}`,
  );
}
