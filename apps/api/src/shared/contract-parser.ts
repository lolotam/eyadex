import type { z } from "zod";

import { ApiError } from "./errors.ts";
import { envelopeIssues } from "./zod-envelope.ts";

/**
 * Parses a value that is still in hand and is not a request body the pipe already owns. A failure is
 * ordinary `validation`: `report_range_too_long` stays on the request pipe, and a raw `ZodError` in
 * the filter still has no value to classify from. The value is not retained on the error.
 */
export function parseContract<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError("validation", envelopeIssues(result.error.issues, value));
  }
  return result.data;
}
