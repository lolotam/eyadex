import { randomUUID } from "node:crypto";

import { APP, call, type Harness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import { memberOn, roleIdOf } from "../../identity/__tests__/user-fixtures.ts";
import type { AuthorizationInvalidator } from "../../identity/index.ts";

const URL = "/v1/patients";
const WEIGHTS = [2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];

// A random start per run: the shared test database is never emptied, and files of one clinic must
// never collide on a phone or a civil ID by accident.
let serial = Math.floor(Math.random() * 5000);

/**
 * A fictional, checksum-valid civil ID that encodes `birthDate` (same algorithm as the web seed). Never
 * a real person's number; a checksum of 10 (no digit) moves the serial on.
 */
export function fakeCivilId(birthDate = "1990-04-01"): string {
  const [year = "", month = "", day = ""] = birthDate.split("-");
  const head = `${Number(year) < 2000 ? "2" : "3"}${year.slice(2)}${month}${day}`;
  for (;;) {
    serial += 1;
    const body = `${head}${String(serial % 10000).padStart(4, "0")}`;
    const sum = WEIGHTS.reduce((t, w, i) => t + (body.charCodeAt(i) - 0x30) * w, 0);
    const check = 11 - (sum % 11);
    if (check <= 9) return `${body}${check}`;
  }
}

/** A fictional Kuwait-shaped mobile (the 5550 prefix), unique within this run. */
export const fakePhone = (): string => {
  serial += 1;
  return `5550${String(serial % 10000).padStart(4, "0")}`;
};

export const patientBody = (branchId: string, extra: Record<string, unknown> = {}) => ({
  fullName: "Test Patient",
  phone: fakePhone(),
  birthDate: "1990-04-01",
  gender: "female",
  registrationBranchId: branchId,
  civilId: fakeCivilId(),
  ...extra,
});

export const searchBody = (extra: Record<string, unknown> = {}) => ({
  cursor: null,
  limit: 100,
  q: "",
  branchId: null,
  status: null,
  ...extra,
});

const withCookie = (cookie: string | undefined) => (cookie === undefined ? {} : { cookie });

export const search = (h: Harness, cookie: string | undefined, extra = {}, host = APP) =>
  call(h, { url: `${URL}/search`, host, body: searchBody(extra), ...withCookie(cookie) });

export const createPatient = (
  h: Harness,
  cookie: string | undefined,
  body: Record<string, unknown>,
  key: string | null = randomUUID(),
  host = APP,
) =>
  call(h, {
    url: URL,
    host,
    body,
    headers: key === null ? {} : { "idempotency-key": key },
    ...withCookie(cookie),
  });

export const openPatient = (h: Harness, cookie: string | undefined, id: string, host = APP) =>
  call(h, { method: "GET", url: `${URL}/${id}`, host, ...withCookie(cookie) });

export const updatePatient = (
  h: Harness,
  cookie: string | undefined,
  id: string,
  body: Record<string, unknown>,
  host = APP,
) => call(h, { method: "PUT", url: `${URL}/${id}`, host, body, ...withCookie(cookie) });

export const patientAction = (
  h: Harness,
  cookie: string | undefined,
  id: string,
  action: "archive" | "restore",
  host = APP,
) => call(h, { url: `${URL}/${id}/${action}`, host, ...withCookie(cookie) });

export const branchOptions = (
  h: Harness,
  cookie: string | undefined,
  action: "view" | "create" | "update",
  host = APP,
) =>
  call(h, { method: "GET", url: `${URL}/branch-options/${action}`, host, ...withCookie(cookie) });

export const code = (res: { json: () => unknown }) => (res.json() as { code?: string }).code;

/** A branch written as the owner (branch creation has its own slice and tests). */
export async function addBranch(h: Harness, clinicId: string, active = true): Promise<string> {
  const id = randomUUID();
  await h.owner`INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
                VALUES (${clinicId}, ${id}, 'فرع', ${`Branch ${id.slice(0, 6)}`}, ${active}, now(), now())`;
  return id;
}

/** Turns the clinic's patients module on or off (the platform's flag), then bumps the cache. */
export async function setPatientsModule(
  h: Harness,
  invalidate: AuthorizationInvalidator,
  clinicId: string,
  enabled: boolean,
): Promise<void> {
  await h.owner`UPDATE clinic_features SET enabled = ${enabled}, updated_at = now()
                WHERE clinic_id = ${clinicId} AND module = 'patients'`;
  await invalidate.clinicChanged(clinicId);
}

export const patientAudit = (h: Harness, clinicId: string, patientId: string) =>
  h.owner`SELECT action, category, entity_type, branch_id, actor_user_id, details,
            details::text AS raw
          FROM audit_log WHERE clinic_id = ${clinicId} AND entity_id = ${patientId}
          ORDER BY created_at, id`;

/**
 * A clinic with an admin (clinic scope), a doctor on branch D (view only), a receptionist on branch R
 * only (view/create/update at branch scope) and one more branch X nobody but the admin covers.
 */
export async function patientsClinic(h: Harness) {
  const base = await clinicWithMembers(h);
  const clinicId = base.admin.clinicId;
  const branchR = await addBranch(h, clinicId);
  const branchX = await addBranch(h, clinicId);
  const receptionist = await memberOn(h, base.admin, await roleIdOf(h, clinicId, "receptionist"), {
    allBranches: false,
    branchIds: [branchR],
  });
  return {
    clinicId,
    admin: base.admin,
    doctor: base.doctor,
    receptionist,
    branchD: base.doctor.branchId,
    branchR,
    branchX,
  };
}

/** Creates a file as `cookie` and returns its id and file number (throws on anything but 201). */
export async function filed(
  h: Harness,
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ id: string; fileNumber: number }> {
  const res = await createPatient(h, cookie, body);
  if (res.statusCode !== 201) throw new Error(`create failed: ${res.statusCode} ${code(res)}`);
  const { id, fileNumber } = res.json() as { id: string; fileNumber: number };
  return { id, fileNumber };
}

/** The stored civil ID columns of one file, and the whole row as JSON text (for "never stored" checks). */
export async function storedCivilId(h: Harness, clinicId: string, id: string) {
  const [row] = await h.owner`SELECT p.civil_id_enc, p.civil_id_hmac, p.civil_id_last4,
                                row_to_json(p)::text AS raw
                              FROM patients p WHERE p.clinic_id = ${clinicId} AND p.id = ${id}`;
  return row as {
    civil_id_enc: string | null;
    civil_id_hmac: string | null;
    civil_id_last4: string | null;
    raw: string;
  };
}
