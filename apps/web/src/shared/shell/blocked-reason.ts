import { ApiError } from "@/shared/api/api-error";

/** The API's `subscription_blocked` carries `details.reason`; anything unreadable reads as expired. */
export function blockedReasonOf(error: unknown): "suspended" | "expired" {
  return error instanceof ApiError && error.details["reason"] === "suspended"
    ? "suspended"
    : "expired";
}
