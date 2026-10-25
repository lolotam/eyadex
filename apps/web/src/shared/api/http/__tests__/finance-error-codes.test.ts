import { describe, expect, it } from "vitest";
import {
  FINANCE_API_ONLY_ERROR_CODES,
  FINANCE_F2_ERROR_CODES,
  FINANCE_F3_ERROR_CODES,
} from "@eyadex/contracts/common";
import type { Persona } from "@eyadex/contracts/session";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { lookup } from "@/shared/i18n/dictionary";
import { ApiError, errorKeyOf, financeError } from "../../api-error";
import { CLINIC, USER, clientWith, me } from "./fetch-stub";

// Finance F2 over HTTP: the codes the API refuses with are in the web catalogue, so the web reads
// them like any other code and the screen shows `errors.<code>` — the message it showed before, when
// the code travelled as `unknown` with the raw code in `details.code`.
const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const INVOICE = "0190a000-0000-7000-8000-0000000000f1";

/** The refusal of a recorded payment: the error the call rejects with. */
async function refused(code: string): Promise<ApiError> {
  const h = clientWith((call) =>
    call.url.startsWith("/api/v1/me")
      ? { body: me }
      : { status: 422, body: { code, message_ar: "رفض", message_en: "Refused" } },
  );
  const error = await h.api.payments
    .recordPayment(P, INVOICE, { method: "cash", amountMinor: "1" }, "key-1")
    .catch((e: unknown) => e);
  if (!(error instanceof ApiError)) throw new Error("expected a refusal");
  return error;
}

describe("the finance F2 codes over HTTP", () => {
  it.each([...FINANCE_F2_ERROR_CODES])("reads %s as its own code", async (code) => {
    const error = await refused(code);
    expect(error.code).toBe(code);
    expect(errorKeyOf(error)).toBe(code);
    // The code is the error's own, so nothing is carried in `details.code` any more.
    expect(error.details).toEqual({});
    // The screen reads `errors.<code>`, and the web already has that message.
    expect(lookup(ar, `errors.${errorKeyOf(error)}`)).not.toBeNull();
  });
});

describe("the F3 export codes (API-only until their web slice ships)", () => {
  it.each([...FINANCE_API_ONLY_ERROR_CODES])("falls back for %s", async (code) => {
    const error = await refused(code);
    expect(error.code).toBe("unknown");
    expect(errorKeyOf(error)).toBe("unknown");
    // The raw code stays readable under `details.code`, as it did before.
    expect(error.details).toEqual({ code });
  });
});

describe("the on-screen report code", () => {
  it("reads report_range_too_long as its own code, with a message in ar and en", async () => {
    expect(FINANCE_F3_ERROR_CODES).toContain("report_range_too_long");
    const error = await refused("report_range_too_long");
    expect(error.code).toBe("report_range_too_long");
    expect(error.details).toEqual({});
    expect(lookup(ar, "errors.report_range_too_long")).not.toBeNull();
    expect(lookup(en, "errors.report_range_too_long")).not.toBeNull();
  });
});

describe("the mock's finance F2 refusal", () => {
  it.each([...FINANCE_F2_ERROR_CODES])("carries %s as its own code", (code) => {
    const error = financeError(code);
    expect(error.code).toBe(code);
    expect(errorKeyOf(error)).toBe(code);
    expect(error.details).toEqual({});
  });
});
