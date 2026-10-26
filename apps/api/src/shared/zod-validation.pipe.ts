import type { PipeTransform } from "@nestjs/common";
import type { z } from "zod";

import { ApiError } from "./errors.ts";
import { envelopeIssue } from "./zod-envelope.ts";

/**
 * Validates a request part against a contract from `@eyadex/contracts` and returns the parsed value
 * (defaults applied, unknown keys refused by strict schemas). A failure becomes `validation` with the issue
 * paths and codes only — never the rejected values, which may be a token or a civil ID.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  readonly #schema: T;

  constructor(schema: T) {
    this.#schema = schema;
  }

  transform(value: unknown): z.output<T> {
    const result = this.#schema.safeParse(value);
    if (!result.success) {
      if (result.error.issues.some((issue) => issue.message === "validation.rangeTooLong")) {
        throw new ApiError("report_range_too_long");
      }
      throw new ApiError("validation", result.error.issues.map(envelopeIssue));
    }
    return result.data;
  }
}
