import type { Tx } from "@eyadex/db";

/** لقطة تفويض حديثة قبل تسليم PDF، بلا بيانات شخصية أو قراءة من الكاش. */
export interface InvoicePdfAccessReader {
  read(
    tx: Tx,
    clinicId: string,
    userId: string,
  ): Promise<{
    readonly membershipId: string;
    readonly active: boolean;
    readonly roleActive: boolean;
    readonly clinicStatus: string;
    readonly expiresAt: string;
    readonly financeEnabled: boolean;
    readonly permissions: readonly string[];
    readonly allBranches: boolean;
    readonly branchIds: readonly string[];
  } | null>;
}
