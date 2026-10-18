import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSourceInvoiceLink } from "./use-source-invoice-link";

const OWN = "00000000-0000-7000-8000-0000000000b1";
const OTHER = "00000000-0000-7000-8000-0000000000b2";

vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    finance: { listInvoices: async () => ({ items: [], nextCursor: null, total: 0 }) },
  }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
  // Sees the clinic's appointments and invoices, but creates invoices only in branch OWN.
  useSession: () => ({
    session: {
      permissions: ["view:invoices:clinic", "create:invoices:branch"],
      allBranches: false,
      branchIds: [OWN],
      features: { finance: true },
    },
  }),
}));

const client = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

afterEach(cleanup);

// PR #78 review: the API's draft judges the create key at the source's branch, so the «فاتورة» action
// is offered only where it would succeed.
describe("the source invoice action", () => {
  it("offers a new invoice in the member's create branch only", async () => {
    // One source id, so both hooks share one loaded lookup: the difference is the branch alone.
    const { result } = renderHook(
      () => [
        useSourceInvoiceLink({ kind: "appointment", id: "a1", branchId: OWN }),
        useSourceInvoiceLink({ kind: "appointment", id: "a1", branchId: OTHER }),
      ],
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current[0]).toEqual({ kind: "create", source: "appointment", id: "a1" }),
    );
    expect(result.current[1]).toBeNull();
  });
});
