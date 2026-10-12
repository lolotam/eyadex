import { describe, expect, it } from "vitest";
import { toCoexistenceBody } from "@/shared/api/http/http-whatsapp";
import { coexistenceDraftOf, toCoexistenceRequest } from "./whatsapp-coexistence-draft";

describe("coexistence form", () => {
  it("omits an empty token so the stored one is kept, and empty templates become null", () => {
    const draft = coexistenceDraftOf(null);
    draft.phoneNumberId = "100000000001";
    draft.businessAccountId = "200000000002";
    draft.templates.booked = { name: "booked_ok", language: "ar" };
    const request = toCoexistenceRequest(draft);
    expect("accessToken" in request).toBe(false);
    expect(request.templates.booked).toEqual({ name: "booked_ok", language: "ar" });
    expect(request.templates.cancelled).toBeNull();
    expect("accessToken" in toCoexistenceBody(request)).toBe(false);
  });
});
