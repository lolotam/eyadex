import type { WebErrorCode } from "@eyadex/contracts/common";

export class ApiError extends Error {
  readonly code: WebErrorCode;
  readonly details: Readonly<Record<string, string | number>>;

  constructor(
    code: WebErrorCode,
    message?: string,
    details: Readonly<Record<string, string | number>> = {},
  ) {
    super(message ?? code);
    this.code = code;
    this.details = details;
    this.name = "ApiError";
  }
}

export function errorCodeOf(error: unknown): WebErrorCode {
  return error instanceof ApiError ? error.code : "unknown";
}
