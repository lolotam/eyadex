// The checksum list mirrors `isValidKuwaitCivilId` in @contracts/patients: the seed must invent
// well-formed numbers that encode their patient's birth date, and the tests below prove they do.

/** Position weights of digits 1..11 of a Kuwaiti civil ID. */
const WEIGHTS = [2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];

/**
 * A fictional 12-digit civil ID that encodes `birthDate` (YYYY-MM-DD). Digits 8..11 are a salt so
 * two seeded files never share a number, and a checksum of 10 — which has no digit — just moves the
 * salt on. Never a real person's number.
 */
export function seedCivilId(birthDate: string, salt: number): string | null {
  const [year, month, day] = birthDate.split("-");
  if (!year || !month || !day) return null;
  const head = `${Number(year) < 2000 ? "2" : "3"}${year.slice(2)}${month}${day}`;
  for (let serial = salt; serial < salt + 100; serial += 1) {
    const body = `${head}${String(serial % 10000).padStart(4, "0")}`;
    const sum = WEIGHTS.reduce(
      (total, weight, i) => total + (body.charCodeAt(i) - 0x30) * weight,
      0,
    );
    const check = 11 - (sum % 11);
    if (check <= 9) return `${body}${check}`;
  }
  return null;
}
