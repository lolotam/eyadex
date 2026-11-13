import { describe, expect, it, vi } from "vitest";
import { createHttpApiClient } from "../http-adapter";
import { errorKeyOf } from "../../api-error";
import { CLINIC, USER } from "./fetch-stub";

const persona = { kind: "custom" as const, clinicId: CLINIC, memberId: USER };

describe("receipt PDF HTTP route", () => {
  it("uses an encoded payment id and cookie credentials, returning the file bytes", async () => {
    const fetch = vi.fn(
      async () => new Response("%PDF-test", { headers: { "Content-Type": "application/pdf" } }),
    );
    const api = createHttpApiClient(fetch);
    const file = await api.payments.pdf(persona, "payment/id");
    expect(fetch).toHaveBeenCalledWith("/api/v1/payments/payment%2Fid/pdf", {
      method: "GET",
      credentials: "same-origin",
    });
    expect(file.type).toBe("application/pdf");
    expect(file.size).toBe(9);
  });

  it.each(["forbidden", "not_found", "pdf_render_failed"])(
    "preserves the %s refusal",
    async (code) => {
      const api = createHttpApiClient(
        async () =>
          new Response(JSON.stringify({ code, message_ar: "", message_en: "" }), {
            status: code === "not_found" ? 404 : code === "forbidden" ? 403 : 503,
          }),
      );
      expect(await api.payments.pdf(persona, "id").catch(errorKeyOf)).toBe(code);
    },
  );
});
