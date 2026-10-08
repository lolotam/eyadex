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

/** Free text a person or the platform typed, carrying a civil ID, a credential and a phone number. */
// The credential last: its redaction takes the rest of the text with it.
export const LEAKY_TEXT = `Leaky ${LEAKS.phone} ${LEAKS.civilId} password=${LEAKS.password}`;

/**
 * A member with the given full name (`LEAKY_TEXT` by default), written as the owner (exempt from the
 * email hold).
 *
 * @param h the harness
 * @param clinicId the clinic
 * @param roleId an existing role of that clinic
 * @param fullName the stored name
 * @returns the member's user id
 */
export async function seedLeakyMember(
  h: Harness,
  clinicId: string,
  roleId: string,
  fullName: string = LEAKY_TEXT,
) {
  const userId = randomUUID();
  await h.owner`INSERT INTO memberships VALUES (${clinicId}, ${randomUUID()}, ${userId}, ${fullName},
    ${`leaky-${userId.slice(0, 8)}@example.test`}, ${roleId}, true, 'active', 'en', NULL, now(), now())`;
  return userId;
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

/** Two names that differ only in what the reader can never see, and Unicode-hidden numbers. */
export const HIDDEN = {
  alpha: "Twin password=alpha-hidden-value-1",
  beta: "Twin password=beta-hidden-value-2",
  // A phone split by a zero-width joiner, a full-width civil ID, and Arabic-Indic phone digits.
  zwj: "Zed 5000‍0006",
  fullWidth: "Wide ３０００００００００００",
  arabic: "عربي ٥٠٠٠٠٠٠٧",
} as const;

/** What the reader is shown for each `HIDDEN` name. */
export const HIDDEN_SHOWN = {
  alpha: "Twin password=[REDACTED]",
  beta: "Twin password=[REDACTED]",
  zwj: "Zed ***006",
  fullWidth: "Wide [REDACTED]",
  arabic: "عربي ***007",
} as const;
