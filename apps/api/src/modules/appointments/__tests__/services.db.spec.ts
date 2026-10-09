import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  auditOf,
  code,
  schedulingClinic,
  send,
  setAppointmentsModule,
} from "./scheduling-fixtures.ts";

// D-12: one clinic-level services list (ADR-0026 §1). Every write audited, names unique like roles.
let h: Harness;
let invalidate: AuthorizationInvalidator;
let C: Awaited<ReturnType<typeof schedulingClinic>>;
let other: Awaited<ReturnType<typeof schedulingClinic>>;
const tag = () => randomUUID().slice(0, 6);
const svc = (minutes = 30, name = tag()) => ({
  nameAr: `خدمة ${name}`,
  nameEn: `Service ${name}`,
  durationMinutes: minutes,
});
const create = (cookie: string, body: unknown, key: string | undefined = randomUUID()) =>
  send(h, cookie, "POST", "/v1/services", body, key);

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await schedulingClinic(h, invalidate);
  other = await schedulingClinic(h, invalidate);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("creating a service", () => {
  it("201 with the service, one audit row; a replay returns it, a changed body conflicts", async () => {
    const key = randomUUID();
    const body = svc();
    const first = await create(C.admin.cookie, body, key);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ ...body, status: "active" });
    const again = await create(C.admin.cookie, body, key);
    expect(again.json()).toEqual(first.json());
    expect(code(await create(C.admin.cookie, svc(), key))).toBe("idempotency_conflict");
    const rows = await auditOf(h, C.clinicId, first.json().id);
    expect(rows.map((r) => [r["action"], r["entity_type"], r["category"]])).toEqual([
      ["service.created", "clinic_service", "administrative"],
    ]);
  });

  it("needs an Idempotency-Key (400)", async () => {
    const res = await send(h, C.admin.cookie, "POST", "/v1/services", svc());
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe("validation");
  });

  it("refuses 4 and 481 minutes (D-15)", async () => {
    expect(code(await create(C.admin.cookie, svc(4)))).toBe("validation");
    expect(code(await create(C.admin.cookie, svc(481)))).toBe("validation");
  });

  it("names are unique per language ignoring case and spaces, inactive services included", async () => {
    const body = svc();
    const made = (await create(C.admin.cookie, body)).json();
    const dup = { ...svc(), nameEn: ` ${body.nameEn.toUpperCase()} ` };
    const res = await create(C.admin.cookie, dup);
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("service_name_taken");
    await send(h, C.admin.cookie, "POST", `/v1/services/${made.id}/deactivate`);
    expect(code(await create(C.admin.cookie, { ...svc(), nameAr: body.nameAr }))).toBe(
      "service_name_taken",
    );
  });
});

describe("changing a service", () => {
  it("update, deactivate, reactivate: one row each; a no-op writes nothing", async () => {
    const made = (await create(C.admin.cookie, svc())).json();
    const path = `/v1/services/${made.id}`;
    const changed = { nameAr: made.nameAr, nameEn: made.nameEn, durationMinutes: 45 };
    expect((await send(h, C.admin.cookie, "PUT", path, changed)).json().durationMinutes).toBe(45);
    expect((await send(h, C.admin.cookie, "PUT", path, changed)).statusCode).toBe(200);
    expect((await send(h, C.admin.cookie, "POST", `${path}/deactivate`)).json().status).toBe(
      "inactive",
    );
    expect((await send(h, C.admin.cookie, "POST", `${path}/deactivate`)).statusCode).toBe(200);
    expect((await send(h, C.admin.cookie, "POST", `${path}/reactivate`)).json().status).toBe(
      "active",
    );
    const actions = (await auditOf(h, C.clinicId, made.id)).map((r) => r["action"]);
    expect(actions).toEqual([
      "service.created",
      "service.updated",
      "service.deactivated",
      "service.reactivated",
    ]);
  });

  it("NEGATIVE: another clinic's service is not found", async () => {
    const theirs = (await create(other.admin.cookie, svc())).json();
    const res = await send(h, C.admin.cookie, "PUT", `/v1/services/${theirs.id}`, svc());
    expect(res.statusCode).toBe(404);
  });
});

describe("reading and permissions", () => {
  it("lists with a status filter and a cursor", async () => {
    const page = await send(h, C.desk.cookie, "GET", "/v1/services?limit=2&status=active");
    expect(page.statusCode).toBe(200);
    const body = page.json();
    expect(body.items.length).toBeLessThanOrEqual(2);
    expect(body.items.every((s: { status: string }) => s.status === "active")).toBe(true);
    if (body.nextCursor !== null) {
      const next = await send(
        h,
        C.desk.cookie,
        "GET",
        `/v1/services?limit=2&cursor=${body.nextCursor}`,
      );
      expect(next.statusCode).toBe(200);
    }
  });

  it("NEGATIVE: view does not create; no key sees nothing", async () => {
    expect(code(await create(C.desk.cookie, svc()))).toBe("forbidden");
    expect(code(await send(h, C.noKeys.cookie, "GET", "/v1/services"))).toBe("forbidden");
  });

  it("NEGATIVE: the module switched off answers module_disabled", async () => {
    await setAppointmentsModule(h, invalidate, C.clinicId, false);
    try {
      expect(code(await send(h, C.admin.cookie, "GET", "/v1/services"))).toBe("module_disabled");
      expect(code(await create(C.admin.cookie, svc()))).toBe("module_disabled");
    } finally {
      await setAppointmentsModule(h, invalidate, C.clinicId, true);
    }
  });
});
