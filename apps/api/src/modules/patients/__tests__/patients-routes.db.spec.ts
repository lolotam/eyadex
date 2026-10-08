import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  formatFileNumber,
  patientDetailSchema,
  patientWriteResultSchema,
  type PatientDetail,
} from "@eyadex/contracts/patients";
import {
  patientBranchOptionListSchema,
  patientListResponseSchema,
} from "@eyadex/contracts/patients-api";

import {
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  addBranch,
  branchOptions,
  code,
  createPatient,
  filed,
  openPatient,
  patientAction,
  patientBody,
  patientsClinic,
  search,
  setPatientsModule,
  updatePatient,
} from "./patient-fixtures.ts";

// Every /v1/patients route: happy path, RBAC-01, FLAG-01 (ADR-0018).
let h: Harness;
let invalidate: AuthorizationInvalidator;
let C: Awaited<ReturnType<typeof patientsClinic>>;
let noKeys: { cookie: string };
let fileId: string;

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await patientsClinic(h);
  noKeys = await memberOn(h, C.admin, await customRole(h, C.clinicId, ["view:branches:clinic"]));
  fileId = (await filed(h, C.admin.cookie, patientBody(C.branchR))).id;
});
afterAll(async () => {
  await closeHarness(h);
});

type Cookie = string | undefined;
const ROUTES: readonly (readonly [
  string,
  (
    cookie: Cookie,
    host?: string,
  ) => Promise<{
    statusCode: number;
    json: () => unknown;
  }>,
  "view" | "write",
])[] = [
  ["POST /v1/patients/search", (c, host) => search(h, c, {}, host), "view"],
  ["GET branch-options/view", (c, host) => branchOptions(h, c, "view", host), "view"],
  ["GET branch-options/create", (c, host) => branchOptions(h, c, "create", host), "write"],
  ["GET branch-options/update", (c, host) => branchOptions(h, c, "update", host), "write"],
  ["GET /v1/patients/:id", (c, host) => openPatient(h, c, fileId, host), "view"],
  [
    "POST /v1/patients",
    (c, host) => createPatient(h, c, patientBody(C.branchR), undefined, host),
    "write",
  ],
  [
    "PUT /v1/patients/:id",
    (c, host) => updatePatient(h, c, fileId, patientBody(C.branchR), host),
    "write",
  ],
  ["POST :id/archive", (c, host) => patientAction(h, c, fileId, "archive", host), "write"],
  ["POST :id/restore", (c, host) => patientAction(h, c, fileId, "restore", host), "write"],
];

describe("RBAC-01: every patients route", () => {
  it.each(ROUTES)(
    "%s: no session 401, no patients key 403, platform host 404",
    async (_n, send) => {
      expect((await send(undefined)).statusCode).toBe(401);
      const refused = await send(noKeys.cookie);
      expect(refused.statusCode).toBe(403);
      expect(code(refused)).toBe("forbidden");
      expect((await send(C.admin.cookie, PLATFORM)).statusCode).toBe(404);
    },
  );

  it.each(ROUTES.filter(([, , kind]) => kind === "write"))(
    "%s: the doctor (view only) is refused with 403",
    async (_n, send) => {
      const res = await send(C.doctor.cookie);
      expect(res.statusCode).toBe(403);
      expect(code(res)).toBe("forbidden");
    },
  );
});

describe("FLAG-01: the patients module switched off", () => {
  it("every route answers module_disabled, even for the clinic admin; re-enabling restores", async () => {
    await setPatientsModule(h, invalidate, C.clinicId, false);
    try {
      for (const [name, send] of ROUTES) {
        const res = await send(C.admin.cookie);
        expect(res.statusCode, name).toBe(403);
        expect(code(res), name).toBe("module_disabled");
      }
    } finally {
      await setPatientsModule(h, invalidate, C.clinicId, true);
    }
    expect((await search(h, C.admin.cookie)).statusCode).toBe(200);
  });
});

describe("happy paths (clinic admin)", () => {
  it("create answers 201 with the next file number and the full file", async () => {
    const body = patientBody(C.branchX, { fullName: "  Happy Path  ", phone: "+965 5550-0001" });
    const res = await createPatient(h, C.admin.cookie, { ...body, phone: undefined });
    expect(res.statusCode).toBe(400);
    const ok = await createPatient(h, C.admin.cookie, body);
    expect(ok.statusCode).toBe(201);
    const result = patientWriteResultSchema.parse(ok.json());
    expect(result.detail).toMatchObject({
      fullName: "Happy Path",
      phone: "+96555500001",
      civilId: body.civilId,
      status: "active",
      registrationBranchId: C.branchX,
      actions: { update: true, deactivate: true },
    });
  });

  it("search lists the caller's files newest first, with only the civil ID's last 4 digits", async () => {
    const res = await search(h, C.admin.cookie);
    expect(res.statusCode).toBe(200);
    const page = patientListResponseSchema.parse(res.json());
    const numbers = page.items.map((p) => p.fileNumber);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(page.total).toBe(page.items.length);
    // Compared with the stored numbers themselves: a pattern like \d{12} also matches inside a UUID.
    const stored = await h.owner`SELECT civil_id FROM patients
                                 WHERE clinic_id = ${C.clinicId} AND civil_id IS NOT NULL`;
    expect(stored.length).toBeGreaterThan(0);
    for (const row of stored) {
      const civilId = row["civil_id"] as string;
      expect(res.body).not.toContain(civilId);
      expect(page.items.map((p) => p.civilIdLast4)).toContain(civilId.slice(-4));
    }
  });

  it("search pages with an opaque cursor and filters by branch, status and search term", async () => {
    const first = patientListResponseSchema.parse(
      (await search(h, C.admin.cookie, { limit: 1 })).json(),
    );
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = patientListResponseSchema.parse(
      (await search(h, C.admin.cookie, { limit: 1, cursor: first.nextCursor })).json(),
    );
    expect(second.items[0]!.fileNumber).toBeLessThan(first.items[0]!.fileNumber);
    const byBranch = patientListResponseSchema.parse(
      (await search(h, C.admin.cookie, { branchId: C.branchX })).json(),
    );
    expect(byBranch.items.every((p) => p.registrationBranchId === C.branchX)).toBe(true);
    const byName = patientListResponseSchema.parse(
      (await search(h, C.admin.cookie, { q: "happy" })).json(),
    );
    expect(byName.items.map((p) => p.fullName)).toEqual(["Happy Path"]);
    const byPhone = patientListResponseSchema.parse(
      (await search(h, C.admin.cookie, { q: "5550-0001" })).json(),
    );
    expect(byPhone.items.map((p) => p.fullName)).toEqual(["Happy Path"]);
    const [happy] = await h.owner`SELECT file_number, civil_id FROM patients
                                  WHERE clinic_id = ${C.clinicId} AND full_name = 'Happy Path'`;
    const padded = formatFileNumber(Number(happy!["file_number"]));
    const byFileNumber = patientListResponseSchema.parse(
      (await search(h, C.admin.cookie, { q: padded })).json(),
    );
    expect(byFileNumber.items.map((p) => p.fullName)).toEqual(["Happy Path"]);
    // Digits of the civil ID, like the mock (a run of 7 is enough to find the file).
    const byCivilDigits = patientListResponseSchema.parse(
      (await search(h, C.admin.cookie, { q: (happy!["civil_id"] as string).slice(5) })).json(),
    );
    expect(byCivilDigits.items.map((p) => p.fullName)).toContain("Happy Path");
    const bad = await search(h, C.admin.cookie, { cursor: "bm90LWEtbnVtYmVy" });
    expect(bad.statusCode).toBe(400);
  });

  it("search by a phone typed in Arabic-Indic, Persian or full-width digits finds the file", async () => {
    const inScript = (zero: number) => (digits: string) =>
      digits.replace(/\d/g, (d) => String.fromCharCode(zero + Number(d)));
    for (const zero of [0x0660, 0x06f0, 0xff10]) {
      const res = await search(h, C.admin.cookie, { q: inScript(zero)("55500001") });
      const page = patientListResponseSchema.parse(res.json());
      expect(
        page.items.map((p) => p.fullName),
        zero.toString(16),
      ).toEqual(["Happy Path"]);
    }
  });

  it("list rows and the open file carry each branch's names, read through the port", async () => {
    const stored = await h.owner`SELECT id, name_ar, name_en FROM branches
                                 WHERE clinic_id = ${C.clinicId}`;
    const names = new Map(stored.map((b) => [b["id"] as string, [b["name_ar"], b["name_en"]]]));
    const page = patientListResponseSchema.parse((await search(h, C.admin.cookie)).json());
    expect(new Set(page.items.map((p) => p.registrationBranchId)).size).toBeGreaterThan(1);
    for (const item of page.items) {
      expect([item.branchNameAr, item.branchNameEn]).toEqual(names.get(item.registrationBranchId));
    }
    const detail = patientDetailSchema.parse((await openPatient(h, C.admin.cookie, fileId)).json());
    expect([detail.branchNameAr, detail.branchNameEn]).toEqual(
      names.get(detail.registrationBranchId),
    );
  });

  it("open answers the full file", async () => {
    const res = await openPatient(h, C.admin.cookie, fileId);
    expect(res.statusCode).toBe(200);
    const detail: PatientDetail = patientDetailSchema.parse(res.json());
    expect(detail.id).toBe(fileId);
    expect(detail.civilId).toMatch(/^\d{12}$/);
  });

  it("update replaces the editable fields and keeps the file number", async () => {
    const before = patientDetailSchema.parse((await openPatient(h, C.admin.cookie, fileId)).json());
    const body = patientBody(C.branchX, { fullName: "Renamed", civilId: "" });
    const res = await updatePatient(h, C.admin.cookie, fileId, body);
    expect(res.statusCode).toBe(200);
    expect(patientWriteResultSchema.parse(res.json()).detail).toMatchObject({
      fullName: "Renamed",
      fileNumber: before.fileNumber,
      registrationBranchId: C.branchX,
      civilId: null,
    });
  });

  it("archive then restore; a repeat is a no-op answer", async () => {
    const archived = await patientAction(h, C.admin.cookie, fileId, "archive");
    expect(patientWriteResultSchema.parse(archived.json()).detail?.status).toBe("archived");
    const again = await patientAction(h, C.admin.cookie, fileId, "archive");
    expect(patientWriteResultSchema.parse(again.json()).detail?.status).toBe("archived");
    const restored = await patientAction(h, C.admin.cookie, fileId, "restore");
    expect(patientWriteResultSchema.parse(restored.json()).detail?.status).toBe("active");
    const [row] = await h.owner`SELECT count(*)::int AS n FROM patients WHERE id = ${fileId}`;
    expect(row!["n"]).toBe(1);
  });

  it("branch options: every branch of the clinic for clinic scope, inactive ones flagged", async () => {
    const inactive = await addBranch(h, C.clinicId, false);
    for (const action of ["view", "create", "update"] as const) {
      const res = await branchOptions(h, C.admin.cookie, action);
      expect(res.statusCode, action).toBe(200);
      const options = patientBranchOptionListSchema.parse(res.json());
      expect(options.map((b) => b.id)).toEqual(
        expect.arrayContaining([C.branchD, C.branchR, C.branchX, inactive]),
      );
      expect(options.find((b) => b.id === inactive)?.isActive).toBe(false);
    }
  });
});
