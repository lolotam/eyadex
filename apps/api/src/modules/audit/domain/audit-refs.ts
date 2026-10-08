import { shownText } from "./audit-text.ts";

type Snapshot = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The reference fields the snapshots carry; the Phase-A mock shows them with their names too.
const ROLE_KEYS = ["roleId"] as const;
const BRANCH_KEYS = ["branchId", "branchIds", "registrationBranchId"] as const;

/** الـ ids اللي في اللقطات ومحتاجة اسم. */
export interface RefIds {
  readonly roles: readonly string[];
  readonly branches: readonly string[];
}

/** الأسماء اللي القارئ قدر يقراها، بالـ id. */
export interface RefNames {
  readonly roles: ReadonlyMap<string, { nameAr: string; nameEn: string }>;
  readonly branches: ReadonlyMap<string, { nameAr: string; nameEn: string }>;
}

const idsUnder = (snapshot: Snapshot | null, keys: readonly string[]): string[] =>
  snapshot === null
    ? []
    : keys
        .flatMap((key) => {
          const value = snapshot[key];
          return Array.isArray(value) ? value : [value];
        })
        .filter((value): value is string => typeof value === "string" && UUID.test(value));

/**
 * كل ids الأدوار والفروع في لقطات صفحة واحدة، من غير تكرار.
 *
 * @param snapshots لقطات قبل/بعد بعد الـ allowlist
 * @returns الـ ids
 */
export function refIdsOf(snapshots: readonly (Snapshot | null)[]): RefIds {
  return {
    roles: [...new Set(snapshots.flatMap((s) => idsUnder(s, ROLE_KEYS)))],
    branches: [...new Set(snapshots.flatMap((s) => idsUnder(s, BRANCH_KEYS)))],
  };
}

/**
 * بيبدّل id الدور/الفرع بـ `{ id, nameAr, nameEn }` زي الـ mock. اسم مش متاح للقارئ → الاسمين
 * `null`. الأسماء نفسها بتعدّي على `shownText` زي أي نص معروض.
 *
 * @param snapshot اللقطة بعد التنضيف
 * @param names الأسماء اللي اتقرت
 * @returns اللقطة بالأسماء
 */
export function withRefNames(snapshot: Snapshot | null, names: RefNames): Snapshot | null {
  if (snapshot === null) return null;
  const out: Snapshot = { ...snapshot };
  const name = (map: RefNames["roles"]) => (value: unknown) => {
    if (typeof value !== "string" || !UUID.test(value)) return value;
    const found = map.get(value);
    return {
      id: value,
      nameAr: found === undefined ? null : shownText(found.nameAr),
      nameEn: found === undefined ? null : shownText(found.nameEn),
    };
  };
  for (const [keys, map] of [
    [ROLE_KEYS, names.roles],
    [BRANCH_KEYS, names.branches],
  ] as const) {
    const named = name(map);
    for (const key of keys) {
      if (!(key in out)) continue;
      const value = out[key];
      out[key] = Array.isArray(value) ? value.map(named) : named(value);
    }
  }
  return out;
}
