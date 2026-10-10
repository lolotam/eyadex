import { vi } from "vitest";
import { ApiError } from "../../api-error";
import { createHttpApiClient } from "../http-adapter";

export type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  credentials: string | undefined;
};

/** A fetch that answers from a queue (or by route) and records every request. */
export function stubFetch(answer: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      credentials: init?.credentials,
    };
    calls.push(call);
    const { status = 200, body } = answer(call);
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

export const NOW = new Date("2026-01-31T10:00:00Z");
export const CLINIC = "0190a000-0000-7000-8000-000000000001";
export const BRANCH = "0190a000-0000-7000-8000-000000000002";
export const USER = "0190a000-0000-7000-8000-000000000003";
export const ROLE = "0190a000-0000-7000-8000-000000000004";
export const INVITE = "0190a000-0000-7000-8000-000000000005";
export const TS = "2026-01-01T00:00:00.000Z";

export const me = {
  user: { id: USER, fullName: "Test User", email: "user@example.test", preferredLanguage: "ar" },
  clinic: {
    id: CLINIC,
    nameAr: "ع",
    nameEn: "C",
    timezone: "Asia/Kuwait",
    status: "active",
    expiresAt: "2027-01-01T00:00:00.000Z",
  },
  role: { id: ROLE, nameAr: "ر", nameEn: "R" },
  permissions: ["view:branches:clinic"],
  allBranches: true,
  branchIds: [],
  modules: ["patients"],
  expiresInDays: null,
};
export const branchDetail = {
  id: BRANCH,
  nameAr: "ف",
  nameEn: "B",
  address: null,
  phone: null,
  isActive: true,
  exclusiveMemberCount: 0,
  createdAt: TS,
  updatedAt: TS,
};
export const userView = {
  id: USER,
  userId: USER,
  clinicId: CLINIC,
  fullName: "Test User",
  email: "user@example.test",
  roleId: ROLE,
  allBranches: true,
  branchIds: [],
  status: "active",
  preferredLanguage: "ar",
  lastLoginAt: null,
  createdAt: TS,
  roleNameAr: "ر",
  roleNameEn: "R",
};
export const invitation = {
  id: INVITE,
  clinicId: CLINIC,
  email: "new@example.test",
  fullName: "New Person",
  roleId: ROLE,
  allBranches: true,
  branchIds: [],
  status: "pending",
  expiresAt: TS,
  createdAt: TS,
  invitedBy: "A",
  respondedAt: null,
  roleNameAr: "ر",
  roleNameEn: "R",
  token: null,
};
export const roleSummary = {
  id: ROLE,
  systemKey: null,
  nameAr: "ر",
  nameEn: "R",
  isLocked: false,
  isActive: true,
  activeUserCount: 2,
  memberCount: 3,
  permissionKeys: ["view:branches:clinic"],
};
export const platformDetail = {
  id: CLINIC,
  slug: "test-clinic",
  nameAr: "ع",
  nameEn: "C",
  specialty: "general",
  status: "active",
  access: "allowed",
  expiresAt: TS,
  defaultLanguage: "en",
  timezone: "Asia/Kuwait",
  createdAt: TS,
  modules: { patients: true, appointments: false, medical: false },
  usage: { users: { used: 2, max: 10 }, branches: { used: 1, max: 3 } },
};
export const page = <T>(items: T[]) => ({ items, nextCursor: null, total: items.length });

/** A client whose clinic id is already known (from /v1/me), so each test sees one request. */
export function clientWith(answer: Parameters<typeof stubFetch>[0]) {
  const stub = stubFetch(answer);
  return { ...stub, api: createHttpApiClient(stub.fetchImpl, () => NOW) };
}

/** The error code a call rejects with ("resolved" when it does not reject). */
export async function code(p: Promise<unknown>): Promise<{ code: string; details?: unknown }> {
  try {
    await p;
  } catch (e) {
    return e instanceof ApiError ? { code: e.code, details: e.details } : { code: "not-api" };
  }
  return { code: "resolved" };
}

export const inspection = {
  clinicNameAr: "ع",
  clinicNameEn: "C",
  email: "new@example.test",
  fullName: "New Person",
  expiresAt: "2026-02-01T00:00:00.000Z",
};
