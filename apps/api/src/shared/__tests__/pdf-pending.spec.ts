import { HttpException, type ArgumentsHost } from "@nestjs/common";
import {
  apiErrorCodeSchema,
  apiErrorEnvelopeSchema,
  webErrorCodeSchema,
} from "@eyadex/contracts/common";
import { describe, expect, it, vi } from "vitest";

import { ApiError, codeForStatus } from "../errors.ts";
import { EnvelopeExceptionFilter } from "../exception.filter.ts";

const pending = {
  code: "pdf_pending",
  message_ar: "ملف PDF قيد التجهيز؛ حاول بعد لحظات.",
  message_en: "The PDF is being prepared; try again shortly.",
};

function response(exception: unknown) {
  const reply = { status: vi.fn().mockReturnThis(), send: vi.fn(), header: vi.fn() };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({ log: { error: vi.fn() } }),
    }),
  } as unknown as ArgumentsHost;
  new EnvelopeExceptionFilter().catch(exception, host);
  return reply;
}

describe("the inactive PDF pending contract", () => {
  it("belongs to both catalogues and preserves the envelope schema", () => {
    expect(apiErrorCodeSchema.parse("pdf_pending")).toBe("pdf_pending");
    expect(webErrorCodeSchema.parse("pdf_pending")).toBe("pdf_pending");
    expect(apiErrorEnvelopeSchema.parse(pending)).toEqual(pending);
  });

  it("returns exactly the sanitized bilingual envelope at 409 without metadata", () => {
    const error = new ApiError("pdf_pending", {
      jobId: "synthetic-job",
      key: "synthetic-object",
      metadata: { revision: 7 },
    });
    Object.assign(error, { jobId: "synthetic-job", key: "synthetic-object" });
    error.message = "synthetic internal diagnostic";
    const reply = response(error);
    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith(pending);
    expect(reply.header).not.toHaveBeenCalled();
  });

  it("never substitutes pending for a generic framework 409", () => {
    expect(codeForStatus(409)).toBe("two_factor_busy");
    for (const error of [
      new HttpException({ ...pending, jobId: "synthetic-job" }, 409),
      { statusCode: 409, ...pending },
    ]) {
      const reply = response(error);
      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.send).toHaveBeenCalledWith(new ApiError("two_factor_busy").toEnvelope());
    }
  });

  it("preserves existing unavailable and PDF failure responses", () => {
    for (const code of ["pdf_busy", "pdf_render_failed"] as const) {
      expect(new ApiError(code).status).toBe(503);
    }
    expect(new ApiError("unknown", { code: "unavailable" }).toEnvelope().details).toEqual({
      code: "unavailable",
    });
  });
});
