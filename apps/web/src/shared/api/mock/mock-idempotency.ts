/**
 * The ledger key of a clinic write's Idempotency-Key. The API claims a key under the operation and
 * the acting user (`branch:create:<userId>`, `patients:create:<userId>`…) inside the clinic, so two
 * users of one clinic never share a key. Each mock ledger holds one operation, so the clinic, the
 * actor and the key are enough. Entries saved before this scope (`clinicId:key`) never match it.
 */
export function actorReplayKey(clinicId: string, actorId: string, key: string): string {
  return `${clinicId}:${actorId}:${key}`;
}
