import type { ApiErrorCode } from "@contracts/common";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: Readonly<Record<string, string | number>>;

  constructor(code: ApiErrorCode, message?: string, details: Readonly<Record<string, string | number>> = {}) {
    super(message ?? code);
    this.code = code;
    this.details = details;
    this.name = "ApiError";
  }
}

export function errorCodeOf(error: unknown): ApiErrorCode {
  return error instanceof ApiError ? error.code : "unknown";
}
