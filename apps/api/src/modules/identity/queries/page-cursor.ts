import { ApiError } from "../../../shared/errors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cursor is the last id seen, base64url-encoded so the client treats it as opaque. */
export const encodeCursor = (id: string) => Buffer.from(id).toString("base64url");

export function decodeCursor(cursor: string | undefined): string | null {
  if (cursor === undefined) return null;
  const id = Buffer.from(cursor, "base64url").toString();
  if (!UUID.test(id)) throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  return id;
}

// LIKE metacharacters in the search are literal text, not wildcards.
export const likePattern = (search: string | undefined) =>
  search === undefined ? null : `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const iso = (value: Date | string) => new Date(value).toISOString();
