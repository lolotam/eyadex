import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryBlobStore } from "../../../shared/blob/memory-blob-store.ts";
import {
  APP,
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import {
  auditSince,
  financeClinic,
  manualInvoice,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Plan Task 8h (spec §3.3, §8 rule 9): the clinic's finance settings, its logo in the private bucket and
// each branch's invoice prefix.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;
const store = new MemoryBlobStore();

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("rest of a tiny png"),
]);

const upload = (cookie: string, url: string, type: string, payload: Buffer) =>
  h.app.inject({
    method: "PUT",
    url,
    headers: { host: new URL(APP).host, origin: APP, cookie, "content-type": type },
    payload,
  });
const getLogo = (cookie: string) =>
  h.app.inject({
    method: "GET",
    url: "/v1/clinic/logo",
    headers: { host: new URL(APP).host, origin: APP, cookie },
  });
const setPrefix = (cookie: string, branchId: string, invoicePrefix: string) =>
  send(h, cookie, "PUT", `/v1/invoice-prefixes/${branchId}`, { invoicePrefix });

beforeAll(async () => {
  h = await openHarness({}, true, { blobStore: store });
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
});

afterAll(() => closeHarness(h));

describe("finance settings", () => {
  it("are read by any member: the platform's currency and tax, no CR number, no logo", async () => {
    const res = await send(h, C.doctor.cookie, "GET", "/v1/clinic/settings/finance");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      currency: "KWD",
      currencyExponent: 3,
      taxRateBp: 0,
      commercialRegNo: null,
      hasLogo: false,
    });
  });

  it("save the commercial registration number with an administrative audit row", async () => {
    const since = new Date();
    const res = await send(h, C.admin.cookie, "PATCH", "/v1/clinic/settings/finance", {
      commercialRegNo: "CR-445566",
    });
    expect(res.json()).toMatchObject({ commercialRegNo: "CR-445566" });
    const [row] = await auditSince(h, C.clinicId, since);
    expect(row).toMatchObject({
      action: "clinic.commercial_reg_no_set",
      category: "administrative",
    });
  });

  it("refuse a member without the clinic settings key", async () => {
    const res = await send(h, C.desk.cookie, "PATCH", "/v1/clinic/settings/finance", {
      commercialRegNo: null,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("logo", () => {
  it("stores a PNG in the bucket and serves it back to any member", async () => {
    const res = await upload(C.admin.cookie, "/v1/clinic/logo", "image/png", PNG);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hasLogo: true });
    expect([...store.stored.keys()].some((k) => k.startsWith(`clinic/${C.clinicId}/logo/`))).toBe(
      true,
    );
    const read = await getLogo(C.doctor.cookie);
    expect(read.headers["content-type"]).toBe("image/png");
    expect(read.rawPayload.equals(PNG)).toBe(true);
  });

  it("judges the type by the bytes, not the header", async () => {
    const res = await upload(C.admin.cookie, "/v1/clinic/logo", "image/png", Buffer.from("GIF89a"));
    expect([res.statusCode, code(res)]).toEqual([400, "validation"]);
  });

  // A framework 413 or 415 is `validation` (errors.ts codeForStatus): only a rule with its own code
  // keeps the status, and the logo has none.
  it("refuses a logo over 1 MB before it reaches the bucket", async () => {
    const before = store.stored.size;
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    const res = await upload(C.admin.cookie, "/v1/clinic/logo", "image/png", big);
    expect([res.statusCode, code(res)]).toEqual([400, "validation"]);
    expect(store.stored.size).toBe(before);
  });

  it("refuses an image body on any other route", async () => {
    const url = `/v1/invoice-prefixes/${C.branchD}`;
    const res = await upload(C.admin.cookie, url, "image/png", PNG);
    expect([res.statusCode, code(res)]).toEqual([400, "validation"]);
  });
});

describe("invoice prefix (spec §8 rule 9)", () => {
  it("is set per branch and refused when another branch holds it", async () => {
    const set = await setPrefix(C.admin.cookie, C.branchR, "DESK");
    expect(set.json()).toEqual({ branchId: C.branchR, invoicePrefix: "DESK", locked: false });
    const taken = await setPrefix(C.admin.cookie, C.branchX, "DESK");
    expect([taken.statusCode, code(taken)]).toEqual([409, "invoice_prefix_taken"]);
  });

  it("locks after the branch's first invoice, and setting the same value again is a no-op", async () => {
    await setPrefix(C.admin.cookie, C.branchD, "SLMD");
    await manualInvoice(h, C.admin.cookie, await patientIn(h, C, C.branchD), C.branchD);
    const same = await setPrefix(C.admin.cookie, C.branchD, "SLMD");
    expect(same.json()).toMatchObject({ invoicePrefix: "SLMD", locked: true });
    const changed = await setPrefix(C.admin.cookie, C.branchD, "NEWD");
    expect([changed.statusCode, code(changed)]).toEqual([409, "invoice_prefix_locked"]);
    const list = await send(h, C.admin.cookie, "GET", "/v1/invoice-prefixes");
    expect((list.json() as { items: unknown[] }).items).toContainEqual({
      branchId: C.branchD,
      invoicePrefix: "SLMD",
      locked: true,
    });
  });

  it("is refused to a member without the branches key", async () => {
    expect((await setPrefix(C.desk.cookie, C.branchR, "ABC")).statusCode).toBe(403);
  });
});
