import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { patientWriteResultSchema } from "@eyadex/contracts/patients";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import {
  createPatient,
  openPatient,
  patientAction,
  patientAudit,
  patientBody,
  patientsClinic,
  search,
  updatePatient,
} from "./patient-fixtures.ts";

// AUD-01 for patients and the civil ID rule (CLAUDE.md §5, §8; PRD §4.11; ADR-0018).
let h: Harness;
let C: Awaited<ReturnType<typeof patientsClinic>>;

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await patientsClinic(h);
});
afterAll(async () => {
  await closeHarness(h);
});

const SNAPSHOT_KEYS = [
  "fileNumber",
  "fullName",
  "gender",
  "id",
  "phone",
  "registrationBranchId",
  "status",
];

describe("every open is audited as patient access", () => {
  it("two opens write two patient.opened rows with only the id and file number", async () => {
    const body = patientBody(C.branchR);
    const created = patientWriteResultSchema.parse(
      (await createPatient(h, C.admin.cookie, body)).json(),
    );
    expect((await openPatient(h, C.receptionist.cookie, created.id)).statusCode).toBe(200);
    expect((await openPatient(h, C.receptionist.cookie, created.id)).statusCode).toBe(200);
    const rows = (await patientAudit(h, C.clinicId, created.id)).filter(
      (r) => r["action"] === "patient.opened",
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row["category"]).toBe("patient_access");
      expect(row["entity_type"]).toBe("patient");
      expect(row["branch_id"]).toBe(C.branchR);
      expect(row["actor_user_id"]).toBe(C.receptionist.userId);
      expect(row["details"]).toEqual({
        before: null,
        after: { id: created.id, fileNumber: created.fileNumber },
      });
    }
  });

  it("an open refused by scope writes nothing", async () => {
    const created = patientWriteResultSchema.parse(
      (await createPatient(h, C.admin.cookie, patientBody(C.branchX))).json(),
    );
    expect((await openPatient(h, C.receptionist.cookie, created.id)).statusCode).toBe(404);
    expect(await patientAudit(h, C.clinicId, created.id)).toHaveLength(1);
  });
});

describe("audit snapshots of writes", () => {
  it("create, update, archive, restore: allowlisted keys, masked phone, no civil ID", async () => {
    const body = patientBody(C.branchR);
    const created = patientWriteResultSchema.parse(
      (await createPatient(h, C.admin.cookie, body)).json(),
    );
    const edited = patientBody(C.branchR, { fullName: "Edited" });
    await updatePatient(h, C.admin.cookie, created.id, edited);
    await patientAction(h, C.admin.cookie, created.id, "archive");
    await patientAction(h, C.admin.cookie, created.id, "restore");
    const rows = await patientAudit(h, C.clinicId, created.id);
    expect(rows.map((r) => r["action"])).toEqual([
      "patient.created",
      "patient.updated",
      "patient.archived",
      "patient.restored",
    ]);
    for (const row of rows) {
      expect(row["category"]).toBe("patient_access");
      const details = row["details"] as { before: object | null; after: object };
      for (const snapshot of [details.before, details.after].filter((s) => s !== null)) {
        expect(Object.keys(snapshot!).sort()).toEqual(SNAPSHOT_KEYS);
      }
      const raw = row["raw"] as string;
      // The allowlist itself keeps them out: nothing had to be redacted after the fact.
      expect(raw).not.toContain("[REDACTED]");
      expect(raw).not.toContain("civil");
      for (const secret of [body.civilId, edited.civilId, body.phone, edited.phone]) {
        expect(raw).not.toContain(secret);
      }
    }
    const updated = rows[1]!["details"] as { after: { phone: string; fullName: string } };
    expect(updated.after.phone).toBe(`***${edited.phone.slice(-3)}`);
    expect(updated.after.fullName).toBe("Edited");
  });
});

describe("the civil ID and the phone never leave through a side channel", () => {
  it("not in the logs of a create, a search by civil ID, an open or an update", async () => {
    const body = patientBody(C.branchR);
    const start = h.logs.length;
    const res = await createPatient(h, C.admin.cookie, body);
    const { id } = patientWriteResultSchema.parse(res.json());
    await search(h, C.admin.cookie, { q: body.civilId });
    await openPatient(h, C.admin.cookie, id);
    await updatePatient(h, C.admin.cookie, id, { ...body, fullName: "Logged?" });
    // A rejected write too: the duplicate path must not log the value it compared.
    await createPatient(h, C.admin.cookie, patientBody(C.branchR, { civilId: body.civilId }));
    const logs = h.logs.slice(start).join("\n");
    expect(logs).toContain("request completed");
    expect(logs).not.toContain(body.civilId);
    expect(logs).not.toContain(body.phone);
    expect(logs).not.toContain(body.phone.slice(-7));
  });

  it("the idempotency ledger keeps ids only", async () => {
    const key = randomUUID();
    const body = patientBody(C.branchR);
    await createPatient(h, C.admin.cookie, body, key);
    const [row] = await h.owner`SELECT response, response::text AS raw, request_hash
                                FROM clinic_idempotency_keys
                                WHERE clinic_id = ${C.clinicId} AND key = ${key}`;
    expect(Object.keys(row!["response"] as object).sort()).toEqual(["fileNumber", "id"]);
    for (const text of [row!["raw"] as string, row!["request_hash"] as string]) {
      expect(text).not.toContain(body.civilId);
      expect(text).not.toContain(body.phone);
    }
  });

  it("the list answer carries only the civil ID's last 4 digits, even when searched by it", async () => {
    const body = patientBody(C.branchR);
    await createPatient(h, C.admin.cookie, body);
    const res = await search(h, C.admin.cookie, { q: body.civilId });
    expect(res.body).toContain(body.civilId.slice(-4));
    expect(res.body).not.toContain(body.civilId);
  });

  it("a validation error names the field, never the value", async () => {
    const civil = "290040112340"; // checksum-invalid on purpose
    const res = await createPatient(h, C.admin.cookie, patientBody(C.branchR, { civilId: civil }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("civilId");
    expect(res.body).not.toContain(civil);
  });
});
