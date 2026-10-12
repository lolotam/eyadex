import { z } from "zod";
import { webErrorCodeSchema } from "@eyadex/contracts/common";
import { ApiError } from "../api-error";

// Loose on purpose: an unknown code must still be read so it can become "unknown".
const envelopeSchema = z.object({ code: z.string(), details: z.unknown().optional() });
const issueListSchema = z.array(
  z.object({ path: z.array(z.union([z.string(), z.number()])), code: z.string() }),
);

/**
 * The web `details` record. The API's validation list `[{ path, code }]` becomes `{ "a.b": code }`;
 * an object keeps its number and string values only (e.g. `count`), never nested lists such as
 * member names.
 */
export function flattenDetails(details: unknown): Record<string, string | number> {
  const issues = issueListSchema.safeParse(details);
  if (issues.success) {
    return Object.fromEntries(issues.data.map((issue) => [issue.path.join("."), issue.code]));
  }
  if (details === null || typeof details !== "object" || Array.isArray(details)) return {};
  const flat: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "number" || typeof value === "string") flat[key] = value;
  }
  return flat;
}

/** The error a failed response becomes: the envelope's code when the web knows it. */
export function errorFromResponse(status: number, body: unknown): ApiError {
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) {
    if (status === 401) return new ApiError("unauthorized");
    if (status === 409) return new ApiError("conflict");
    return new ApiError("unknown");
  }
  const code = webErrorCodeSchema.safeParse(envelope.data.code);
  if (code.success) return new ApiError(code.data, undefined, flattenDetails(envelope.data.details));
  // An uncatalogued code (e.g. WhatsApp's `unavailable`) stays readable under `details.code`.
  return new ApiError("unknown", undefined, {
    ...flattenDetails(envelope.data.details),
    code: envelope.data.code,
  });
}
