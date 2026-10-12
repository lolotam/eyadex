import { ConfigurationError, configurationVariables } from "./configuration-error.ts";

/**
 * Log serializers. The defaults would print an error's message, its causes, its stack and every
 * enumerable property, and a request's full URL — each can carry a secret the key-based sanitizer cannot
 * see. These print only values from finite lists: nothing an error or a request carries is copied as-is.
 */

// Names and codes are printed only if they are on these lists — a pattern would admit any secret shaped
// to fit it. Anything else is replaced ("Error") or omitted.
const KNOWN_NAMES = new Set([
  "Error",
  "AggregateError",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "AbortError",
  "TimeoutError",
  "ApiError",
  "PostgresError",
  "ZodError",
  "ConfigurationError",
  "HttpException",
  "NotFoundException",
  "BadRequestException",
]);

const KNOWN_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "EADDRINUSE",
  "FST_ERR_BAD_URL",
  "FST_ERR_CTP_BODY_TOO_LARGE",
  "FST_ERR_CTP_INVALID_MEDIA_TYPE",
  "FST_ERR_NOT_FOUND",
]);

/**
 * Any thrown value as a recognised type and a recognised code. The message, the causes, the stack and
 * every other property are never printed: stack text starts with the message and a multiline message can
 * imitate any frame, so no line of it can be trusted. A non-Error becomes a fixed label.
 *
 * @param error whatever was thrown
 * @returns a diagnostic safe to log
 */
export function errorDiagnostic(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: "NonError" };
  const code = (error as { code?: unknown }).code;
  return {
    type: KNOWN_NAMES.has(error.name) ? error.name : "Error",
    ...(typeof code === "string" && KNOWN_CODES.has(code) ? { code } : {}),
    // A failed start names the setting to fix (names only, re-checked); without it the log said just
    // "Error" and the operator had to guess which variable Dokploy was missing.
    ...(error instanceof ConfigurationError ? { variables: configurationVariables(error) } : {}),
  };
}

interface LoggableRequest {
  method?: string;
  id?: string;
  routeOptions?: { url?: string };
}

/**
 * A request as its method and matched route pattern (`/v1/clinics/:id`) — never the raw URL, whose
 * path segments and query string can carry tokens, civil IDs or phone numbers.
 *
 * @param request the Fastify request
 * @returns method, route pattern and request id
 */
export function requestDiagnostic(request: LoggableRequest | object): Record<string, unknown> {
  const { method, id, routeOptions } = request as LoggableRequest;
  return { method, route: routeOptions?.url ?? "[unmatched]", reqId: id };
}

/**
 * A response as its status code only — headers can carry `set-cookie`.
 *
 * @param reply the Fastify reply
 * @returns the status code
 */
export function responseDiagnostic(reply: object): Record<string, unknown> {
  return { statusCode: (reply as { statusCode?: number }).statusCode };
}
