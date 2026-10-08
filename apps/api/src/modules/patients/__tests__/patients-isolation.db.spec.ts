import { ModulesContainer } from "@nestjs/core";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { patientWriteResultSchema } from "@eyadex/contracts/patients";
import {
  patientBranchOptionListSchema,
  patientListResponseSchema,
} from "@eyadex/contracts/patients-api";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { registeredRoutes } from "../../identity/index.ts";
import {
  branchOptions,
  code,
  createPatient,
  filed,
  openPatient,
  patientAction,
  patientBody,
  patientsClinic,
  search,
  updatePatient,
} from "./patient-fixtures.ts";

// RBAC-02 (branch scope), ISO-02 (two clinics over HTTP), RLS as eyadex_app, PLAT-01/02 (ADR-0018).
let h: Harness;
let A: Awaited<ReturnType<typeof patientsClinic>>;
let B: Awaited<ReturnType<typeof patientsClinic>>;
let inR: string;
let inX: string;

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await patientsClinic(h);
  B = await patientsClinic(h);
  inR = (await filed(h, A.admin.cookie, patientBody(A.branchR))).id;
  inX = (await filed(h, A.admin.cookie, patientBody(A.branchX))).id;
});
afterAll(async () => {
  await closeHarness(h);
});

const ids = (res: { json: () => unknown }) =>
  patientListResponseSchema.parse(res.json()).items.map((p) => p.id);

describe("RBAC-02: a receptionist scoped to branch R", () => {
  it("lists branch R files only, and the total counts only those", async () => {
    const res = await search(h, A.receptionist.cookie);
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toContain(inR);
    expect(ids(res)).not.toContain(inX);
    expect(patientListResponseSchema.parse(res.json()).total).toBe(ids(res).length);
    const filtered = await search(h, A.receptionist.cookie, { branchId: A.branchX });
    expect(ids(filtered)).toEqual([]);
  });

  it("opens a branch R file, but a branch X file is not_found (never forbidden)", async () => {
    expect((await openPatient(h, A.receptionist.cookie, inR)).statusCode).toBe(200);
    const res = await openPatient(h, A.receptionist.cookie, inX);
    expect(res.statusCode).toBe(404);
    expect(code(res)).toBe("not_found");
  });

  it("cannot update a branch X file (404) nor move a branch R file to branch X (403)", async () => {
    const outside = await updatePatient(h, A.receptionist.cookie, inX, patientBody(A.branchX));
    expect(outside.statusCode).toBe(404);
    const move = await updatePatient(h, A.receptionist.cookie, inR, patientBody(A.branchX));
    expect(move.statusCode).toBe(403);
    expect(code(move)).toBe("forbidden");
  });

  it("files into branch R, but filing into branch X is forbidden", async () => {
    expect((await createPatient(h, A.receptionist.cookie, patientBody(A.branchR))).statusCode).toBe(
      201,
    );
    const res = await createPatient(h, A.receptionist.cookie, patientBody(A.branchX));
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe("forbidden");
  });

  it("is offered branch R only, for each action it holds", async () => {
    for (const action of ["view", "create", "update"] as const) {
      const res = await branchOptions(h, A.receptionist.cookie, action);
      expect(
        patientBranchOptionListSchema.parse(res.json()).map((b) => b.id),
        action,
      ).toEqual([A.branchR]);
    }
  });

  it("sees update allowed and deactivate refused on its own rows", async () => {
    const page = patientListResponseSchema.parse((await search(h, A.receptionist.cookie)).json());
    const row = page.items.find((p) => p.id === inR);
    expect(row?.actions).toEqual({ update: true, deactivate: false });
  });

  it("row actions follow each action's own branch scope, not the view scope", async () => {
    // Views every branch, but may edit and archive branch R only.
    const role = await customRole(h, A.clinicId, [
      "view:patients:clinic",
      "update:patients:branch",
      "deactivate:patients:branch",
    ]);
    const editor = await memberOn(h, A.admin, role, { allBranches: false, branchIds: [A.branchR] });
    const page = patientListResponseSchema.parse((await search(h, editor.cookie)).json());
    const actionsOf = (id: string) => page.items.find((p) => p.id === id)?.actions;
    expect(actionsOf(inR)).toEqual({ update: true, deactivate: true });
    expect(actionsOf(inX)).toEqual({ update: false, deactivate: false });
  });

  it("a write that moves a file out of the caller's VIEW scope answers it without detail", async () => {
    // View at branch scope (R) but update at clinic scope: the move is allowed, the file then hidden.
    const role = await customRole(h, A.clinicId, [
      "view:patients:branch",
      "update:patients:clinic",
    ]);
    const mover = await memberOn(h, A.admin, role, { allBranches: false, branchIds: [A.branchR] });
    const own = await filed(h, A.admin.cookie, patientBody(A.branchR));
    const res = await updatePatient(h, mover.cookie, own.id, patientBody(A.branchX));
    expect(res.statusCode).toBe(200);
    expect(patientWriteResultSchema.parse(res.json())).toEqual({
      id: own.id,
      fileNumber: own.fileNumber,
      detail: null,
    });
    expect((await openPatient(h, mover.cookie, own.id)).statusCode).toBe(404);
  });

  it("the doctor (branch D, view only) sees none of branch R or X", async () => {
    const res = await search(h, A.doctor.cookie);
    expect(ids(res)).not.toContain(inR);
    expect(ids(res)).not.toContain(inX);
    expect((await openPatient(h, A.doctor.cookie, inR)).statusCode).toBe(404);
  });
});

describe("ISO-02: another clinic", () => {
  it("its admin cannot open, update, archive or list clinic A's files", async () => {
    expect((await openPatient(h, B.admin.cookie, inR)).statusCode).toBe(404);
    expect((await updatePatient(h, B.admin.cookie, inR, patientBody(B.branchR))).statusCode).toBe(
      404,
    );
    expect((await patientAction(h, B.admin.cookie, inR, "archive")).statusCode).toBe(404);
    const list = await search(h, B.admin.cookie);
    expect(ids(list)).not.toContain(inR);
    expect(ids(list)).not.toContain(inX);
  });

  it("cannot file a patient under clinic A's branch", async () => {
    const res = await createPatient(h, B.admin.cookie, patientBody(A.branchR));
    expect(res.statusCode).toBe(404);
  });

  it("the same phone and civil ID are accepted in a second clinic (PAT-02 is per clinic)", async () => {
    const body = patientBody(A.branchR);
    expect((await createPatient(h, A.admin.cookie, body)).statusCode).toBe(201);
    expect(
      (await createPatient(h, B.admin.cookie, { ...body, registrationBranchId: B.branchR }))
        .statusCode,
    ).toBe(201);
  });

  it("RLS: eyadex_app under clinic B's context reads 0 rows of clinic A and updates none", async () => {
    const db = h.app.get<Database>(DATABASE);
    const { rows, updated } = await db.withTenant(B.clinicId, async (tx) => ({
      rows: await tx.execute(sql`SELECT id FROM patients WHERE id = ${inR}`),
      updated: await tx.execute(
        sql`UPDATE patients SET full_name = 'x' WHERE id = ${inR} RETURNING id`,
      ),
    }));
    expect(rows).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });
});

describe("PLAT-01 / PLAT-02: the platform never sees patient data", () => {
  it("the eyadex_platform login is refused on patients and on the file counter", async () => {
    const platform = postgres(process.env["EYADEX_TEST_PLATFORM_URL"]!, { max: 1 });
    try {
      for (const table of ["patients", "clinic_counters"]) {
        await expect(platform.unsafe(`SELECT 1 FROM ${table} LIMIT 1`)).rejects.toMatchObject({
          code: "42501",
        });
      }
    } finally {
      await platform.end();
    }
  });

  it("no platform route needs a patients key, and every patients route is a gated clinic route", () => {
    const routes = registeredRoutes(h.app.get(ModulesContainer));
    const patientRoutes = routes.filter((r) => /^\w+ \/v1\/patients(\/|$)/.test(r.route));
    expect(patientRoutes.map((r) => r.route).sort()).toEqual(
      [
        "GET /v1/patients/:id",
        "GET /v1/patients/branch-options/create",
        "GET /v1/patients/branch-options/update",
        "GET /v1/patients/branch-options/view",
        "POST /v1/patients",
        "POST /v1/patients/:id/archive",
        "POST /v1/patients/:id/restore",
        "POST /v1/patients/search",
        "PUT /v1/patients/:id",
      ].sort(),
    );
    for (const route of patientRoutes) {
      expect(route.feature, route.route).toBe("patients");
      expect(route.rules[0]?.kind, route.route).toBe("require");
    }
    for (const route of routes.filter((r) => r.route.includes("/v1/platform"))) {
      const rule = route.rules[0];
      const key = rule?.kind === "require" ? rule.permission : "";
      expect(key.includes(":patients:") || route.feature === "patients", route.route).toBe(false);
    }
  });
});
