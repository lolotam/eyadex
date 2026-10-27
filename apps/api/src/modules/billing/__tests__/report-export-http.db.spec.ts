import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { reportExportListResponseSchema } from "@eyadex/contracts/finance-reports";
import {
  APP,
  PLATFORM,
  call,
  closeHarness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { exportHttpFixture, type ExportHttpFixture } from "./report-export-http.fixtures.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";

let f: ExportHttpFixture;
beforeAll(async () => {
  f = await exportHttpFixture();
});
afterEach(() => f.onGet(null));
afterAll(async () => closeHarness(f?.h));

describe("export HTTP privacy and current download authority", () => {
  it("queues the row and one id-only outbox event, without building synchronously", async () => {
    const response = await f.call(f.C.admin.cookie, "POST", "", f.body());
    expect(response.statusCode, response.body).toBe(202);
    const id = response.json().export.id as string;
    const rows = await f.h
      .owner`SELECT status, storage_key FROM finance_report_exports WHERE id = ${id}`;
    expect(rows[0]).toMatchObject({ status: "queued", storage_key: null });
    const events = await f.h
      .owner`SELECT payload FROM outbox_events WHERE payload->>'exportId' = ${id}`;
    expect(events.map((e) => e["payload"])).toEqual([{ exportId: id }]);
    expect((await f.call(f.C.admin.cookie, "GET", `/${id}/download`)).statusCode).toBe(404);
  });

  it("denies a missing report key, foreign branches, another requester and platform host", async () => {
    expect((await f.call(f.C.priceReader.cookie, "POST", "", f.body())).statusCode).toBe(403);
    expect(
      (
        await f.call(
          f.C.admin.cookie,
          "POST",
          "",
          f.body("daily_takings", { branchId: f.other.branchD }),
        )
      ).statusCode,
    ).toBe(403);
    const row = await f.published();
    expect((await f.call(f.other.admin.cookie, "GET", row.path)).statusCode).toBe(404);
    expect((await f.call(f.C.doctor.cookie, "GET", `/${row.id}`)).statusCode).toBe(404);
    const platform = await call(f.h, {
      host: PLATFORM,
      method: "GET",
      url: `/v1/finance-reports/exports${row.path}`,
      cookie: f.C.admin.cookie,
    });
    expect(platform.statusCode).toBe(404);
  });

  it("serves a private attachment and validates the list's requester-only cursor", async () => {
    const row = await f.published();
    const response = await f.call(f.C.admin.cookie, "GET", row.path);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).toBe("sample export");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["content-disposition"]).toContain(`finance-report-${row.id}.csv`);
    const first = reportExportListResponseSchema.parse(
      (await f.call(f.C.admin.cookie, "GET", "?limit=1")).json(),
    );
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = reportExportListResponseSchema.parse(
      (await f.call(f.C.admin.cookie, "GET", `?limit=1&cursor=${first.nextCursor}`)).json(),
    );
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(Object.keys(first.items[0]!).sort()).toEqual(
      ["byteSize", "createdAt", "expiresAt", "format", "id", "report", "rowCount", "status"].sort(),
    );
  });

  it("opens sealed patient-named files with the exact attempt additional data", async () => {
    const row = await f.published(f.C.admin.cookie, "outstanding");
    expect((await f.call(f.C.admin.cookie, "GET", row.path)).body).toBe("sample export");
    const wrong = await f.published(f.C.admin.cookie, "outstanding");
    f.bytes.set(wrong.key, f.bytes.get(row.key)!);
    expect((await f.call(f.C.admin.cookie, "GET", wrong.path)).statusCode).toBe(500);
  });

  it("denies expiry before storage and expiry during storage", async () => {
    const row = await f.published();
    const expire = () =>
      f.h
        .owner`UPDATE finance_report_exports SET expires_at = clock_timestamp() - interval '1 second' WHERE id = ${row.id}`.then(
        () => undefined,
      );
    f.onGet(expire);
    expect((await f.call(f.C.admin.cookie, "GET", row.path)).statusCode).toBe(404);
    f.onGet(null);
    const count = f.reads.length;
    expect((await f.call(f.C.admin.cookie, "GET", row.path)).statusCode).toBe(404);
    expect(f.reads).toHaveLength(count);
  });

  it("a permission revoked while bytes are fetched prevents the answer, despite the guard cache", async () => {
    const row = await f.published(f.branch.cookie);
    const [member] = await f.h
      .owner`SELECT role_id FROM memberships WHERE clinic_id = ${f.C.clinicId} AND id = ${f.branch.memberId}`;
    f.onGet(async () => {
      await f.h.owner`DELETE FROM role_permissions rp USING permissions p
      WHERE rp.clinic_id = ${f.C.clinicId} AND rp.role_id = ${member!["role_id"] as string}
        AND rp.permission_id = p.id AND p.key = 'view:report_takings:branch'`;
    });
    const response = await f.call(f.branch.cookie, "GET", row.path);
    expect(response.statusCode, response.body).toBe(403);
  });

  it("a clinic-to-branch scope downgrade returns not_found without serving stored wider data", async () => {
    const member = await memberOn(
      f.h,
      f.C.admin,
      await customRole(f.h, f.C.clinicId, ["view:report_takings:clinic", "view:payments:clinic"]),
    );
    const row = await f.published(member.cookie);
    const role = await customRole(f.h, f.C.clinicId, [
      "view:report_takings:branch",
      "view:payments:branch",
    ]);
    await f.h
      .owner`UPDATE memberships SET role_id = ${role}, all_branches = false WHERE clinic_id = ${f.C.clinicId} AND id = ${member.memberId}`;
    expect((await f.call(member.cookie, "GET", row.path)).statusCode).toBe(404);
  });

  it("an own patient leaving reach is denied and purged immediately; ids remain until expiry", async () => {
    const row = await f.published(f.C.doctor.cookie, "own_summary", [f.patientD]);
    const response = await f.call(f.C.doctor.cookie, "GET", row.path);
    expect(response.statusCode, response.body).toBe(404);
    expect(f.deletes).toContain(row.key);
    const [stored] = await f.h
      .owner`SELECT status, storage_key, to_jsonb(patient_ids) AS ids FROM finance_report_exports WHERE id = ${row.id}`;
    expect(stored).toMatchObject({ status: "purged", storage_key: null, ids: [f.patientD] });
    expect(f.bytes.has(row.key)).toBe(false);
    const [blob] = await f.h
      .owner`SELECT state FROM finance_report_export_blobs WHERE export_id = ${row.id}`;
    expect(blob!["state"]).toBe("deleted");
  });

  it("an own export without a patient set fails closed", async () => {
    const row = await f.published(f.C.doctor.cookie, "own_summary");
    const count = f.reads.length;
    expect((await f.call(f.C.doctor.cookie, "GET", row.path)).statusCode).toBe(404);
    expect(f.reads).toHaveLength(count);
  });

  it("declines malformed ids and refuses missing sessions", async () => {
    expect((await f.call(f.C.admin.cookie, "GET", "/invalid/download")).statusCode).toBe(404);
    expect(
      (
        await call(f.h, {
          host: APP,
          method: "GET",
          url: `/v1/finance-reports/exports/${randomUUID()}/download`,
        })
      ).statusCode,
    ).toBe(401);
  });
});
