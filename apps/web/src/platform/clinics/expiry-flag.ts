const SOON_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * "Expired" is computed from the expiry, never stored (PRD §4.9): a clinic whose stored status is
 * still active or trial is flagged expired once its expiry has passed, and "soon" within two weeks.
 */
export function expiryFlagOf(expiresAt: string, now: number): "expired" | "soon" | null {
  const left = new Date(expiresAt).getTime() - now;
  if (left <= 0) return "expired";
  return left < SOON_MS ? "soon" : null;
}
