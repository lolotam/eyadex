import type {
  reportByDoctorResponseSchema,
  reportByServiceResponseSchema,
} from "@eyadex/contracts/finance-reports";
import type { z } from "zod";

export type ByServiceResponse = z.infer<typeof reportByServiceResponseSchema>;
export type ByDoctorResponse = z.infer<typeof reportByDoctorResponseSchema>;
export type RevenueRow = ByServiceResponse["rows"][number] | ByDoctorResponse["rows"][number];
export type RevenueResponse = ByServiceResponse | ByDoctorResponse;

/**
 * The tax row is shown last whatever order the response uses (the contract does not promise one);
 * every other row keeps the order it arrived in. Display only, never a business rule.
 */
export function taxLast<T extends { kind: string }>(rows: readonly T[]): T[] {
  return [...rows.filter((r) => r.kind !== "tax"), ...rows.filter((r) => r.kind === "tax")];
}
