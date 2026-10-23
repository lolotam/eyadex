import type {
  CashClosingDetail,
  CashClosingListQuery,
  CashClosingPreview,
  CreateCashClosingRequest,
  cashClosingListResponseSchema,
} from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import type { z } from "zod";

export type CashClosingList = z.infer<typeof cashClosingListResponseSchema>;

/**
 * Finance F2 card 2b (spec §4.4, §4.6): a branch's cash drawer closed once a business day. A closing is
 * never edited or reopened, and no answer names a patient.
 */
export interface CashClosingsApi {
  /** Stores nothing; needs `create:cash_closings` reaching the branch. */
  preview(persona: Persona, branchId: string): Promise<CashClosingPreview>;
  /** Repeats the preview's position; a retry with the same key replays the first closing. */
  close(
    persona: Persona,
    input: CreateCashClosingRequest,
    idempotencyKey: string,
  ): Promise<CashClosingDetail>;
  /** Needs `view:cash_closings`; newest first, inside its reach. */
  list(persona: Persona, query: Partial<CashClosingListQuery>): Promise<CashClosingList>;
  get(persona: Persona, closingId: string): Promise<CashClosingDetail>;
}
