import { randomUUID } from "node:crypto";

import type { JSONValue } from "postgres";

import { call, type Harness } from "../../identity/auth/__tests__/auth-http-harness.ts";

/** Recognisable fakes: a response or log containing any of them leaked a hidden field. */
export const LEAKS = {
  token: "tok_recognisable_fake_audit_token_456",
  password: "recognisable-fake-audit-password-123",
  civilId: "300000000000",
  phone: "+96500000004",
} as const;

export interface SeedRow {
  readonly clinicId: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly category?: "administrative" | "patient_access";
  readonly entityType: string;
  readonly createdAt: string;
  readonly details?: JSONValue;
  readonly id?: string;
}

/**
 * One audit row written as the owner (the API has no writer for every case), at a pinned instant.
 *
 * @param h the harness
 * @param row the row; the id defaults to a fresh UUID
 * @returns the row id
 */
export async function seedAudit(h: Harness, row: SeedRow): Promise<string> {
  const id = row.id ?? randomUUID();
  await h.owner`INSERT INTO audit_log VALUES (${row.clinicId}, ${id}, ${row.actorUserId}, ${row.action},
    ${row.category ?? "administrative"}, ${row.entityType}, ${randomUUID()}, NULL,
    ${h.owner.json(row.details ?? {})}, ${row.createdAt}::timestamptz)`;
  return id;
}

/** A branch row whose stored details carry every kind of value the reader must never show. */
export const leakyBranchDetails = {
  before: { nameAr: "قديم", nameEn: "Old", tokenHash: LEAKS.token, isActive: true },
  after: {
    nameAr: `جديد ${LEAKS.civilId}`,
    nameEn: "New",
    phone: LEAKS.phone,
    password: LEAKS.password,
    civilId: LEAKS.civilId,
    isActive: true,
  },
  token: LEAKS.token,
};

/** A GET with a query string. */
export const getList = (h: Harness, host: string, path: string, cookie?: string, query = "") =>
  call(h, {
    method: "GET",
    url: `${path}${query === "" ? "" : `?${query}`}`,
    host,
    ...(cookie === undefined ? {} : { cookie }),
  });

export interface ListBody {
  items: { id: string; at: string; action: string; [key: string]: unknown }[];
  nextCursor: string | null;
  total: number;
}

/**
 * Every page of a list, following `nextCursor`.
 *
 * @param page loads one page from a cursor
 * @returns every item in order
 */
export async function allPages(page: (cursor: string | null) => Promise<ListBody>) {
  const items: ListBody["items"] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 100; guard += 1) {
    const body = await page(cursor);
    items.push(...body.items);
    if (body.nextCursor === null) return items;
    cursor = body.nextCursor;
  }
  throw new Error("pagination did not end");
}
