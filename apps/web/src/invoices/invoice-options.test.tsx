import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInvoiceOptions } from "./invoice-options";

const OWN = "00000000-0000-7000-8000-0000000000b1";
const OTHER = "00000000-0000-7000-8000-0000000000b2";
const branch = (id: string) => ({ id, nameAr: id, nameEn: id, isActive: true });

vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    scheduling: {
      // 150 services in pages of 100: the second page must be read too.
      listServices: async (_p: unknown, q: { cursor: string | null; limit: number }) => {
        const start = q.cursor ? Number(q.cursor) : 0;
        const all = Array.from({ length: 150 }, (_, i) => ({ id: `s${i}` }));
        const end = Math.min(start + q.limit, all.length);
        return { items: all.slice(start, end), nextCursor: end < all.length ? String(end) : null };
      },
      listProviders: async () => [],
    },
    patients: { branchOptions: async () => [branch(OWN), branch(OTHER)] },
  }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
  // Sees every branch's patients, creates invoices in branch OWN only.
  useSession: () => ({
    session: {
      permissions: ["view:patients:clinic", "create:invoices:branch"],
      allBranches: false,
      branchIds: [OWN],
    },
  }),
}));

const client = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

afterEach(cleanup);

// PR #78 review: the manual invoice form offers the branches the create key reaches (the API's issue
// rule), not every branch whose patients the member sees; the list filter keeps those.
describe("the invoice form's branches", () => {
  it("are the create key's branches, while the filter keeps the patients view's", async () => {
    const { result } = renderHook(() => useInvoiceOptions(), { wrapper });
    await waitFor(() => expect(result.current.branches).toHaveLength(2));
    expect(result.current.createBranches.map((b) => b.id)).toEqual([OWN]);
  });
});

describe("the invoice form's services", () => {
  it("reads every page, not only the first 100", async () => {
    const { result } = renderHook(() => useInvoiceOptions(), { wrapper });
    await waitFor(() => expect(result.current.services).toHaveLength(150));
  });
});
