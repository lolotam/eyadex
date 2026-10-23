import { parseMajorToMinor, readMinor } from "@eyadex/contracts/money";
import type { BranchOption } from "@eyadex/contracts/users";
import type { SessionContext } from "@eyadex/contracts/session";
import { canAtBranch } from "@/shared/permissions/can-at-branch";

export type DifferenceKind = "balanced" | "shortage" | "surplus";

/** The counted cash typed in major units: zero or more (an empty drawer counts too), else null. */
export function countedMinorOf(text: string, exponent: number): string | null {
  if (text.trim() === "") return null;
  const minor = parseMajorToMinor(text, exponent);
  const amount = minor === null ? null : readMinor(minor);
  return minor !== null && amount !== null && amount >= 0n ? minor : null;
}

/** Counted minus expected, the sign the API saves (a shortage is negative). */
export function differenceOf(countedMinor: string, expectedMinor: string): bigint {
  return BigInt(countedMinor) - BigInt(expectedMinor);
}

export function differenceKind(difference: bigint): DifferenceKind {
  return difference === 0n ? "balanced" : difference < 0n ? "shortage" : "surplus";
}

/** The note the API needs: required when the count differs (`closing_note_required`). */
export const needsNote = (difference: bigint, note: string): boolean =>
  difference !== 0n && note.trim() === "";

type BranchAccess = Pick<SessionContext, "permissions" | "allBranches" | "branchIds">;

/** The branches the close dialog offers: the payments branch options the create key reaches. */
export function closableBranches(
  access: BranchAccess,
  branches: readonly BranchOption[],
): BranchOption[] {
  return branches.filter((b) => canAtBranch(access, "create", "cash_closings", b.id));
}

export type HeldKey = { fingerprint: string; key: string } | null;

/**
 * The closing's Idempotency-Key: a retry of the same request keeps it, so an unclear failure that was in
 * fact recorded replays the first closing; a refreshed preview or another count is a new request.
 */
export function keyFor(previous: HeldKey, fingerprint: string, make: () => string) {
  return previous && previous.fingerprint === fingerprint ? previous : { fingerprint, key: make() };
}
