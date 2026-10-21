// The opaque cursor is the last id without its dashes: ids are UUID v7, so id order is creation order.
export const toCursor = (id: string) => id.replaceAll("-", "");
export const fromCursor = (cursor: string): string | null => {
  if (!/^[0-9a-f]{32}$/.test(cursor)) return null;
  const at = [8, 12, 16, 20];
  return [0, ...at].map((start, i) => cursor.slice(start, at[i])).join("-");
};
