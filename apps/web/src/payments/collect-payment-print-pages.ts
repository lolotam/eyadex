export type PrintPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type PrintPageReader<T> = (cursor: string | undefined) => Promise<PrintPage<T>>;

export async function collectPaymentPrintPages<T>(
  read: PrintPageReader<T>,
  current: () => boolean,
): Promise<T[] | null> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  do {
    if (!current()) return null;
    const page = await read(cursor);
    if (!current()) return null;
    rows.push(...page.items);
    if (page.nextCursor === null) return rows;
    if (seen.has(page.nextCursor)) throw new Error("Repeated payment print cursor");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (current());

  return null;
}
