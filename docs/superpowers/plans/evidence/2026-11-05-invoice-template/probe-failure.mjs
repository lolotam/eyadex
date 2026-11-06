// Only generated identifiers and fixed mutation names may escape Python stderr.
export function probeFailure(binary, result) {
  const base = `synthetic_probe_failed:${binary}:${result.status ?? result.signal}`;
  if (binary !== "/usr/local/bin/python3") return base;
  const token = (result.stderr?.toString() ?? "")
    .slice(-4096)
    .match(
      /^RuntimeError: (glyph_outline_mismatch:(?:w[a-z0-9]{1,8}|counter-\d{1,3})|drawing_mutation_accepted:(?:missing|duplicate|wrong|moved|association|displaced|missing_character|font_scale|erased_advances))\r?$/m,
    )?.[1];
  return token ? `${base}:${token}` : base;
}
