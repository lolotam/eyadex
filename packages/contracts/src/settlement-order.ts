// The order money moves in (finance spec §4.3, F2-Q18): the newest allocation first when money is
// released, the oldest credit first when it is spent. The timestamps are instants, not text: a database
// `timestamptz` keeps microseconds, so two timestamps of different precision or offset still order by the
// moment they name.

/** A movement that carries the time and the id that order it (F2-Q18). */
interface TimedMovement {
  readonly createdAt: string;
  readonly id: string;
}

const INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * The instant an ISO-8601 text names, in nanoseconds since the epoch: exact for any fraction up to nine
 * digits and for any offset, so the order never depends on how the instant was written.
 *
 * @param iso the timestamp
 * @returns the instant in nanoseconds
 * @throws Error when the text is not an ISO-8601 instant (a programming error at the caller, never user input)
 */
function instantKey(iso: string): bigint {
  const match = INSTANT.exec(iso);
  if (match === null) throw new Error("settlement createdAt is not an ISO-8601 instant");
  const millis = Date.parse(`${match[1] ?? ""}${match[3] ?? ""}`);
  if (Number.isNaN(millis)) throw new Error("settlement createdAt is not an ISO-8601 instant");
  return BigInt(millis) * 1_000_000n + BigInt((match[2] ?? "").padEnd(9, "0"));
}

/** Newest first: the instant down, then the id down (F2-Q18). */
function newestBefore(a: TimedMovement, b: TimedMovement): number {
  const at = instantKey(a.createdAt);
  const bt = instantKey(b.createdAt);
  if (at > bt) return -1;
  if (at < bt) return 1;
  if (a.id > b.id) return -1;
  if (a.id < b.id) return 1;
  return 0;
}

/** Oldest first: the instant up, then the id up (F2-Q18). */
function oldestBefore(a: TimedMovement, b: TimedMovement): number {
  const at = instantKey(a.createdAt);
  const bt = instantKey(b.createdAt);
  if (at < bt) return -1;
  if (at > bt) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * A copy of the movements, newest first: the order money is released in (F2-Q18).
 *
 * @param items the movements
 * @returns a sorted copy; the input keeps its order
 */
export function newestFirst<T extends TimedMovement>(items: readonly T[]): T[] {
  return [...items].sort(newestBefore);
}

/**
 * A copy of the movements, oldest first: the order credit is spent in (F2-Q18).
 *
 * @param items the movements
 * @returns a sorted copy; the input keeps its order
 */
export function oldestFirst<T extends TimedMovement>(items: readonly T[]): T[] {
  return [...items].sort(oldestBefore);
}
