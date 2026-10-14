import { ApiError, errorCodeOf, isWhatsappUnavailable } from "@/shared/api/api-error";

const REFUSALS = ["meta_code_invalid", "meta_two_step_enabled", "number_in_use"] as const;

/** The i18n key for a refused one-click signup or manual save, shown inline under the action. */
export function signupErrorKey(e: unknown): string {
  if (isWhatsappUnavailable(e)) return "whatsapp.unavailableTitle";
  if (e instanceof ApiError) {
    if (e.details["transport"] === "evolution_linked") return "whatsapp.errors.evolution_linked";
    const refusal = REFUSALS.find((r) => Object.values(e.details).includes(r));
    if (refusal) return `whatsapp.errors.${refusal}`;
  }
  return `errors.${errorCodeOf(e)}`;
}
