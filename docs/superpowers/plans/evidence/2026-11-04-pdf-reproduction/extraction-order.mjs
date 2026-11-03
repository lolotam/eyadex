// Match complete fields in source order, consuming each occurrence at most once.
export function orderedFields(text, fields) {
  let cursor = 0;
  const positions = [];
  for (const field of fields) {
    const literal = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${literal}(?![\\p{L}\\p{M}\\p{N}])`, "gu");
    pattern.lastIndex = cursor;
    const match = pattern.exec(text);
    if (!match) return { ordered: false, failedField: field, matchedFields: positions.length };
    positions.push(match.index);
    cursor = match.index + match[0].length;
  }
  return {
    ordered: true,
    matchedFields: positions.length,
    firstPosition: positions[0],
    lastPosition: positions.at(-1),
  };
}
