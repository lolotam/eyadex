import { describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { CLINIC, USER, clientWith, type Call } from "@/shared/api/http/__tests__/fetch-stub";

// P2 brief §1/§13: no clinical text, patient name, medicine name or search query in any URL the HTTP
// adapter builds; they travel in bodies. ICD-10 lookup is the contract's one query (`GET /icd10?q=`).
const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const ID = "0190a000-0000-7000-8000-0000000000d1";
const TEXT = ["Secret complaint", "Rarecillin", "zebra-query", "Jane Doe", "lab.pdf"];

describe("the medical HTTP routes", () => {
  it("puts ids only in URLs and the text in bodies", async () => {
    const { api, calls } = clientWith(() => ({ status: 500 }));
    const swallow = (p: Promise<unknown>) => p.catch(() => undefined);
    await swallow(api.medical.searchVisits(P, ID, { q: TEXT[2]! }));
    await swallow(api.medical.walkInCandidates(P, { branchId: ID, q: TEXT[3]! }));
    await swallow(
      api.medical.saveNote(P, ID, {
        complaint: TEXT[0]!,
        examination: null,
        assessment: null,
        plan: null,
      }),
    );
    await swallow(
      api.medical.savePrescription(P, ID, {
        items: [{ medicine: TEXT[1]!, dose: "1", frequency: "d", duration: "w", note: null }],
      }),
    );
    await swallow(
      api.medical.createMedicine(
        P,
        { name: TEXT[1]!, defaultDose: null, defaultFrequency: null },
        ID,
      ),
    );
    await swallow(api.medical.addAddendum(P, ID, { body: TEXT[0]! }));
    const byPath = (c: Call) => `${c.method} ${c.url}`;
    expect(calls.map(byPath)).toEqual([
      `POST /api/v1/patients/${ID}/visits/search`,
      "POST /api/v1/visits/walk-in-candidates",
      `PUT /api/v1/visits/${ID}/note`,
      `PUT /api/v1/visits/${ID}/prescription`,
      "POST /api/v1/medicines",
      `POST /api/v1/visits/${ID}/addenda`,
    ]);
    for (const c of calls)
      for (const text of TEXT) expect(c.url).not.toContain(encodeURIComponent(text));
    expect(calls[0]!.body).toEqual({ q: TEXT[2] });
    expect(calls[4]!.headers["Idempotency-Key"]).toBe(ID);
  });

  it("parses a visit list with the contract schema", async () => {
    const list = { items: [], nextCursor: null, can: { search: true, start: false } };
    const { api, calls } = clientWith(() => ({ body: list }));
    await expect(api.medical.listVisits(P, ID, { cursor: "abc" })).resolves.toEqual(list);
    expect(calls[0]!.url).toBe(`/api/v1/patients/${ID}/visits?cursor=abc`);
  });
});
