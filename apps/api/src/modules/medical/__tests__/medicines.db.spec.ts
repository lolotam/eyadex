import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { grantKeys, medicalClinic, setModule, type MedicalClinic } from "./medical-fixtures.ts";

// P2-F2, R3-3 (ADR-0029): the clinic's medicines list. Readers need view:medicines:clinic (the doctor's
// default), writers update:medicines:clinic; names are unique per clinic, trimmed and case-folded; a
// medicine is deactivated, never deleted; audit rows are administrative and name fields only.
let h: Harness;
let invalidate: AuthorizationInvalidator;
let C: MedicalClinic;

type Medicine = {
  id: string;
  name: string;
  defaultDose: string | null;
  defaultFrequency: string | null;
  status: string;
};
const MEDICINE_KEYS = ["view:medicines:clinic", "update:medicines:clinic"];
const medicineOf = (res: { json: () => unknown }) =>
  (res.json() as { medicine: Medicine }).medicine;
const create = (cookie: string, body: unknown, key = randomUUID()) =>
  send(h, cookie, "POST", "/v1/medicines", body, key);
const list = async (cookie: string) =>
  ((await send(h, cookie, "GET", "/v1/medicines")).json() as { items: Medicine[] }).items;
const auditOf = (clinicId: string, entityId: string) =>
  h.owner`SELECT action, category, entity_type, details, row_to_json(a)::text AS raw FROM audit_log a
          WHERE clinic_id = ${clinicId} AND entity_id = ${entityId} ORDER BY created_at, id`;

/** Grants the medicines keys to the role `userId` holds, then refreshes the cache. */
async function withMedicineKeys(clinicId: string, userId: string): Promise<void> {
  const [row] = await h.owner`SELECT role_id FROM memberships WHERE user_id = ${userId}`;
  await grantKeys(h, clinicId, row!["role_id"] as string, MEDICINE_KEYS);
  await invalidate.clinicChanged(clinicId);
}

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await medicalClinic(h, invalidate);
  await withMedicineKeys(C.clinicId, C.admin.userId);
  // Spec §2: the doctor's default role reads the list (granted as the owner until the release, R1-16).
  await grantKeys(h, C.clinicId, C.doctor.roleId, ["view:medicines:clinic"]);
  await invalidate.clinicChanged(C.clinicId);
});

afterAll(() => closeHarness(h));

describe("the clinic's medicines (R3-3)", () => {
  it("creates an active medicine (blank defaults are none) and replays the same key", async () => {
    const key = randomUUID();
    const body = { name: "Paracetamol 500 mg", defaultDose: "1 tablet", defaultFrequency: " " };
    const res = await create(C.admin.cookie, body, key);
    expect(res.statusCode).toBe(201);
    const made = medicineOf(res);
    expect(made).toMatchObject({ ...body, defaultFrequency: null, status: "active" });
    const replay = await create(C.admin.cookie, body, key);
    expect(medicineOf(replay).id).toBe(made.id);
    expect(code(await create(C.admin.cookie, { ...body, name: "Other" }, key))).toBe(
      "idempotency_conflict",
    );
    const audit = await auditOf(C.clinicId, made.id);
    expect(audit.map((r) => [r["action"], r["category"], r["entity_type"], r["details"]])).toEqual([
      [
        "medicine.created",
        "administrative",
        "medicine",
        { before: null, after: { changed: ["name", "defaultDose"] } },
      ],
    ]);
    expect(audit[0]!["raw"]).not.toMatch(/Paracetamol|tablet/);
  });

  it("a name taken by any medicine of the clinic, trimmed and case-folded, is medicine_name_taken", async () => {
    const name = `Ibuprofen ${randomUUID().slice(0, 6)}`;
    const first = medicineOf(
      await create(C.admin.cookie, { name, defaultDose: null, defaultFrequency: null }),
    );
    await send(h, C.admin.cookie, "POST", `/v1/medicines/${first.id}/deactivate`);
    const again = await create(C.admin.cookie, {
      name: `  ${name.toUpperCase()} `,
      defaultDose: null,
      defaultFrequency: null,
    });
    expect(again.statusCode).toBe(409);
    expect(code(again)).toBe("medicine_name_taken");
    const other = medicineOf(
      await create(C.admin.cookie, {
        name: `${name} syrup`,
        defaultDose: null,
        defaultFrequency: null,
      }),
    );
    const rename = await send(h, C.admin.cookie, "PUT", `/v1/medicines/${other.id}`, {
      name: name.toLowerCase(),
      defaultDose: null,
      defaultFrequency: null,
    });
    expect(code(rename)).toBe("medicine_name_taken");
  });

  it("updates, deactivates (kept, listed after the active ones) and reactivates, naming fields only", async () => {
    const name = `Aspirin ${randomUUID().slice(0, 6)}`;
    const made = medicineOf(
      await create(C.admin.cookie, { name, defaultDose: null, defaultFrequency: null }),
    );
    const updated = await send(h, C.admin.cookie, "PUT", `/v1/medicines/${made.id}`, {
      name,
      defaultDose: "81 mg",
      defaultFrequency: "daily",
    });
    expect(medicineOf(updated)).toMatchObject({ defaultDose: "81 mg", defaultFrequency: "daily" });
    const same = await send(h, C.admin.cookie, "PUT", `/v1/medicines/${made.id}`, {
      name,
      defaultDose: "81 mg",
      defaultFrequency: "daily",
    });
    expect(same.statusCode).toBe(200);
    const off = await send(h, C.admin.cookie, "POST", `/v1/medicines/${made.id}/deactivate`);
    expect(medicineOf(off).status).toBe("inactive");
    const items = await list(C.admin.cookie);
    const statuses = items.map((m) => m.status);
    expect(statuses.indexOf("inactive")).toBeGreaterThan(statuses.lastIndexOf("active"));
    expect(items.find((m) => m.id === made.id)?.status).toBe("inactive");
    const on = await send(h, C.admin.cookie, "POST", `/v1/medicines/${made.id}/reactivate`);
    expect(medicineOf(on).status).toBe("active");
    const audit = await auditOf(C.clinicId, made.id);
    expect(audit.map((r) => [r["action"], r["details"]])).toEqual([
      ["medicine.created", { before: null, after: { changed: ["name"] } }],
      [
        "medicine.updated",
        { before: null, after: { changed: ["defaultDose", "defaultFrequency"] } },
      ],
      ["medicine.deactivated", { before: null, after: { changed: ["status"] } }],
      ["medicine.reactivated", { before: null, after: { changed: ["status"] } }],
    ]);
    expect(audit.every((r) => !(r["raw"] as string).includes("Aspirin"))).toBe(true);
  });

  it("the doctor reads the list but changes nothing; the front desk cannot read it", async () => {
    const made = medicineOf(
      await create(C.admin.cookie, {
        name: `Cetirizine ${randomUUID().slice(0, 6)}`,
        defaultDose: null,
        defaultFrequency: null,
      }),
    );
    expect((await list(C.doctor.cookie)).map((m) => m.id)).toContain(made.id);
    const body = { name: "x", defaultDose: null, defaultFrequency: null };
    expect(code(await create(C.doctor.cookie, body))).toBe("forbidden");
    expect(code(await send(h, C.doctor.cookie, "PUT", `/v1/medicines/${made.id}`, body))).toBe(
      "forbidden",
    );
    expect(
      code(await send(h, C.doctor.cookie, "POST", `/v1/medicines/${made.id}/deactivate`)),
    ).toBe("forbidden");
    expect(code(await send(h, C.front.cookie, "GET", "/v1/medicines"))).toBe("forbidden");
  });

  it("another clinic's medicine is invisible: not listed, not_found on every write", async () => {
    const B = await clinicWithMembers(h);
    await setModule(h, invalidate, B.admin.clinicId, "medical", true);
    await withMedicineKeys(B.admin.clinicId, B.admin.userId);
    const theirs = medicineOf(
      await create(B.admin.cookie, {
        name: "Clinic B only",
        defaultDose: null,
        defaultFrequency: null,
      }),
    );
    expect((await list(C.admin.cookie)).map((m) => m.id)).not.toContain(theirs.id);
    const body = { name: "hijack", defaultDose: null, defaultFrequency: null };
    expect(code(await send(h, C.admin.cookie, "PUT", `/v1/medicines/${theirs.id}`, body))).toBe(
      "not_found",
    );
    expect(
      code(await send(h, C.admin.cookie, "POST", `/v1/medicines/${theirs.id}/deactivate`)),
    ).toBe("not_found");
    const [row] = await h.owner`SELECT name, status FROM clinic_medicines WHERE id = ${theirs.id}`;
    expect(row).toMatchObject({ name: "Clinic B only", status: "active" });
  });
});
