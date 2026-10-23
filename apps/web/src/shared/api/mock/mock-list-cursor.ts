import { ApiError } from "../api-error";

// The API's list cursor (billing list-cursor.ts): the last id without its dashes; anything else is refused.
export const toCursor = (id: string) => id.replaceAll("-", "");

export function fromCursor(cursor: string): string {
  if (!/^[0-9a-f]{32}$/.test(cursor)) throw new ApiError("validation");
  const at = [8, 12, 16, 20];
  return [0, ...at].map((start, i) => cursor.slice(start, at[i])).join("-");
}
