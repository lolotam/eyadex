// A small demo slice of ICD-10-CM (CDC/NCHS), English titles as published (P2-F1). The API serves
// the full release; this list only lets the demo picker and validation work.
export const ICD10_RELEASE = "ICD-10-CM 2026 (demo subset)";

export const ICD10_DEMO: readonly { code: string; title: string }[] = [
  { code: "F32.0", title: "Major depressive disorder, single episode, mild" },
  { code: "F32.1", title: "Major depressive disorder, single episode, moderate" },
  { code: "F32.9", title: "Major depressive disorder, single episode, unspecified" },
  { code: "F33.1", title: "Major depressive disorder, recurrent, moderate" },
  { code: "F41.0", title: "Panic disorder [episodic paroxysmal anxiety]" },
  { code: "F41.1", title: "Generalized anxiety disorder" },
  { code: "F41.9", title: "Anxiety disorder, unspecified" },
  { code: "F42.2", title: "Mixed obsessional thoughts and acts" },
  { code: "F43.10", title: "Post-traumatic stress disorder, unspecified" },
  { code: "F51.01", title: "Primary insomnia" },
  {
    code: "F90.0",
    title: "Attention-deficit hyperactivity disorder, predominantly inattentive type",
  },
  { code: "G43.909", title: "Migraine, unspecified, not intractable, without status migrainosus" },
  { code: "I10", title: "Essential (primary) hypertension" },
  { code: "E11.9", title: "Type 2 diabetes mellitus without complications" },
  { code: "E78.5", title: "Hyperlipidemia, unspecified" },
  { code: "J06.9", title: "Acute upper respiratory infection, unspecified" },
  { code: "J45.909", title: "Unspecified asthma, uncomplicated" },
  { code: "K21.9", title: "Gastro-esophageal reflux disease without esophagitis" },
  { code: "L20.9", title: "Atopic dermatitis, unspecified" },
  { code: "L70.0", title: "Acne vulgaris" },
  { code: "M54.50", title: "Low back pain, unspecified" },
  { code: "N39.0", title: "Urinary tract infection, site not specified" },
  { code: "O80", title: "Encounter for full-term uncomplicated delivery" },
  { code: "R51.9", title: "Headache, unspecified" },
  {
    code: "Z00.00",
    title: "Encounter for general adult medical examination without abnormal findings",
  },
];

export const icd10Codes: ReadonlySet<string> = new Set(ICD10_DEMO.map((c) => c.code));

// The API's `icd10Terms` (domain/icd10.ts): one code-like word searches code prefixes.
const CODE_LIKE = /^[A-Za-z][0-9][0-9A-Za-z.]*$/;
const first = (hit: boolean) => (hit ? 0 : 1);

/**
 * The API's `searchIcd10` over the demo slice (Codex 4241493941): a code-like query matches code prefixes
 * with the dots dropped on both sides (`F411` finds `F41.1`); every word must be in the title, case
 * folded. Code prefixes first, then titles starting with the first word, then by code; at most 20.
 */
export function searchIcd10Demo(q: string): { code: string; title: string }[] {
  const trimmed = q.trim();
  const codePrefix = CODE_LIKE.test(trimmed) ? trimmed.toUpperCase().replaceAll(".", "") : null;
  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const byCode = (c: { code: string }) =>
    codePrefix !== null && c.code.replaceAll(".", "").startsWith(codePrefix);
  const startsWithWord = (c: { title: string }) => c.title.toLowerCase().startsWith(words[0] ?? "");
  return ICD10_DEMO.filter(
    (c) => byCode(c) || words.every((w) => c.title.toLowerCase().includes(w)),
  )
    .sort(
      (x, y) =>
        first(byCode(x)) - first(byCode(y)) ||
        first(startsWithWord(x)) - first(startsWithWord(y)) ||
        (x.code < y.code ? -1 : x.code > y.code ? 1 : 0),
    )
    .slice(0, 20);
}
