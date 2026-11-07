import { describe, expect, it } from "vitest";
import { ar } from "../../../i18n/ar";
import { en } from "../../../i18n/en";
import { errorKeyOf } from "../../api-error";
import { errorFromResponse } from "../http-errors";

describe("PDF pending HTTP boundary", () => {
  it("retains the code and exact translations without server metadata or diagnostics", () => {
    const error = errorFromResponse(409, {
      code: "pdf_pending",
      message_ar: "synthetic diagnostic",
      message_en: "synthetic diagnostic",
      jobId: "synthetic-job",
      key: "synthetic-object",
      details: { jobId: "synthetic-job", key: "synthetic-object", retryAfter: 2 },
    });
    expect(error.code).toBe("pdf_pending");
    expect(errorKeyOf(error)).toBe("pdf_pending");
    expect(error.message).toBe("pdf_pending");
    expect(error.details).toEqual({});
    expect(ar.errors.pdf_pending).toBe("ملف PDF قيد التجهيز؛ حاول بعد لحظات.");
    expect(en.errors.pdf_pending).toBe("The PDF is being prepared; try again shortly.");
  });

  it("keeps an uncatalogued framework 409 generic", () => {
    expect(errorFromResponse(409, { message: "Conflict" }).code).toBe("conflict");
  });
});
