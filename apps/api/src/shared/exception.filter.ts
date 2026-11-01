import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import { ApiError, codeForStatus } from "./errors.ts";
import { envelopeIssue, withoutAbortedLengthArtifacts } from "./zod-envelope.ts";

/**
 * Every error leaves the API as `{ code, message_ar, message_en, details? }` (CLAUDE.md §6). An unexpected
 * error is logged sanitised and returned as `unknown` — its message never reaches the client, because it can
 * carry SQL, an identifier or a clinic's data.
 */
@Catch()
export class EnvelopeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();

    const error = toApiError(exception);
    if (error.code === "unknown") {
      request.log.error({ err: exception }, "unhandled error");
    }
    void reply.status(error.status).send(error.toEnvelope());
  }
}

function toApiError(exception: unknown): ApiError {
  if (exception instanceof ApiError) return exception;
  // A contract parsed outside a pipe — a query, a path parameter — reaches here as a raw ZodError.
  if (exception instanceof ZodError) {
    return new ApiError(
      "validation",
      withoutAbortedLengthArtifacts(exception.issues).map(envelopeIssue),
    );
  }
  if (exception instanceof HttpException) return new ApiError(codeForStatus(exception.getStatus()));
  const status = (exception as { statusCode?: unknown } | null)?.statusCode;
  // Fastify's own errors (a malformed URL, a body over the size limit) carry a statusCode but are not
  // HttpExceptions.
  if (typeof status === "number" && status >= 400 && status < 500) {
    return new ApiError(codeForStatus(status));
  }
  return new ApiError("unknown");
}
