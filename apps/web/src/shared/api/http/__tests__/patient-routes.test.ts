import { beforeEach, describe, expect, it } from "vitest";
import type { PatientInput } from "@eyadex/contracts/patients";
import type { Persona } from "@eyadex/contracts/session";
import { BRANCH, CLINIC, TS, USER, clientWith, code, me, type Call } from "./fetch-stub";

// The patients namespace over HTTP (ADR-0018): method, path, body, headers and credentials of every
// call, and the rule that a civil ID (or a phone) never reaches a URL.
const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const PATIENT = "0190a000-0000-7000-8000-0000000000aa";
// Fictional and checksum-valid (the web mock's fixture), never a real person's number.
const CIVIL_ID = "290040112347";
const PHONE = "55501234";

const detail = {
  id: PATIENT,
  fileNumber: 7,
  fullName: "Test Patient",
  phone: "+96555501234",
  birthDate: "1990-04-01",
  gender: "female",
  registrationBranchId: BRANCH,
  civilId: CIVIL_ID,
  status: "active",
  createdAt: TS,
  branchNameAr: "ف",
  branchNameEn: "B",
  actions: { update: true, deactivate: true },
};
const listItem = {
  id: PATIENT,
  fileNumber: 7,
  fullName: "Test Patient",
  phone: "+96555501234",
  registrationBranchId: BRANCH,
  branchNameAr: "ف",
  branchNameEn: "B",
  civilIdLast4: "2347",
  status: "active",
  actions: { update: true, deactivate: true },
};
const option = { id: BRANCH, nameAr: "ف", nameEn: "B", isActive: true };
const written = { id: PATIENT, fileNumber: 7, detail };

function answer(call: Call) {
  const path = call.url.replace(/\?.*$/, "");
  if (path === "/api/v1/me") return { body: me };
  if (path === "/api/v1/patients/search")
    return { body: { items: [listItem], nextCursor: "Ng", total: 1 } };
  if (path.startsWith("/api/v1/patients/branch-options/")) return { body: [option] };
  if (call.method === "GET") return { body: detail };
  return {
    body: written,
    status: call.method === "POST" && path === "/api/v1/patients" ? 201 : 200,
  };
}

let h: ReturnType<typeof clientWith>;
beforeEach(() => {
  h = clientWith(answer);
});
const last = () => h.calls.at(-1)!;

const input: PatientInput = {
  fullName: "Test Patient",
  phone: PHONE,
  birthDate: "1990-04-01",
  gender: "female",
  registrationBranchId: BRANCH,
  civilId: CIVIL_ID,
  email: "",
  messageLanguage: "",
  notificationsOptOut: false,
};

describe("patients over HTTP", () => {
  it("list: POST /v1/patients/search with the query in the body, never in the URL", async () => {
    const page = await h.api.patients.list(P, {
      cursor: "NQ",
      limit: 25,
      q: ` ${CIVIL_ID} `,
      branchId: BRANCH,
      status: "active",
    });
    expect(page).toEqual({ items: [listItem], nextCursor: "Ng", total: 1 });
    expect(last()).toMatchObject({
      method: "POST",
      url: "/api/v1/patients/search",
      credentials: "same-origin",
      body: { cursor: "NQ", limit: 25, q: CIVIL_ID, branchId: BRANCH, status: "active" },
    });
    expect(last().headers["Content-Type"]).toBe("application/json");
  });

  it("branchOptions: one GET per action, and an unknown action never reaches the network", async () => {
    for (const action of ["view", "create", "update"] as const) {
      expect(await h.api.patients.branchOptions(P, action)).toEqual([option]);
      expect(last()).toMatchObject({
        method: "GET",
        url: `/api/v1/patients/branch-options/${action}`,
        credentials: "same-origin",
        body: undefined,
      });
    }
    const before = h.calls.length;
    const refused = await code(h.api.patients.branchOptions(P, "../users" as "view"));
    expect(refused.code).toBe("validation");
    expect(h.calls).toHaveLength(before);
  });

  it("open: GET /v1/patients/:id with no body", async () => {
    expect(await h.api.patients.open(P, PATIENT)).toEqual(detail);
    expect(last()).toMatchObject({
      method: "GET",
      url: `/api/v1/patients/${PATIENT}`,
      credentials: "same-origin",
      body: undefined,
    });
  });

  it("create: POST /v1/patients with the form fields and the Idempotency-Key header", async () => {
    const result = await h.api.patients.create(
      P,
      { ...input, extra: "dropped" } as PatientInput,
      "key-p",
    );
    expect(result).toEqual(written);
    expect(last()).toMatchObject({
      method: "POST",
      url: "/api/v1/patients",
      credentials: "same-origin",
      body: input,
    });
    expect(last().headers["Idempotency-Key"]).toBe("key-p");
  });

  it("update: PUT /v1/patients/:id with the form fields and no Idempotency-Key", async () => {
    await h.api.patients.update(P, PATIENT, input);
    expect(last()).toMatchObject({
      method: "PUT",
      url: `/api/v1/patients/${PATIENT}`,
      credentials: "same-origin",
      body: input,
    });
    expect(last().headers["Idempotency-Key"]).toBeUndefined();
  });

  it("archive and restore: POST with no body", async () => {
    for (const action of ["archive", "restore"] as const) {
      await h.api.patients[action](P, PATIENT);
      expect(last()).toMatchObject({
        method: "POST",
        url: `/api/v1/patients/${PATIENT}/${action}`,
        credentials: "same-origin",
        body: undefined,
      });
    }
  });

  it("an id is percent-encoded into its path segment", async () => {
    await h.api.patients.open(P, "a/b?c");
    expect(last().url).toBe("/api/v1/patients/a%2Fb%3Fc");
  });

  it("no request of any method ever carries the civil ID or the phone in its URL", async () => {
    await h.api.patients.list(P, {
      cursor: null,
      limit: 10,
      q: CIVIL_ID,
      branchId: null,
      status: null,
    });
    await h.api.patients.list(P, {
      cursor: null,
      limit: 10,
      q: PHONE,
      branchId: null,
      status: null,
    });
    await h.api.patients.create(P, input, "key-u");
    await h.api.patients.update(P, PATIENT, input);
    for (const call of h.calls) {
      expect(call.url).not.toContain(CIVIL_ID);
      expect(call.url).not.toContain(PHONE);
      expect(call.url).not.toContain("?");
    }
  });

  it("an answer that does not match the API schema is refused, not mapped", async () => {
    const bad = clientWith((call) =>
      call.url.endsWith("/search") ? { body: { items: [{ id: PATIENT }] } } : { body: me },
    );
    const res = await code(
      bad.api.patients.list(P, { cursor: null, limit: 10, q: "", branchId: null, status: null }),
    );
    expect(res.code).toBe("unknown");
  });

  it("an API error reaches the screen with its code and details", async () => {
    const taken = clientWith(() => ({
      status: 409,
      body: {
        code: "patient_phone_taken",
        message_ar: "x",
        message_en: "x",
        details: { patientId: PATIENT, fileNumber: 7 },
      },
    }));
    expect(await code(taken.api.patients.create(P, input, "key-t"))).toEqual({
      code: "patient_phone_taken",
      details: { patientId: PATIENT, fileNumber: 7 },
    });
  });
});
