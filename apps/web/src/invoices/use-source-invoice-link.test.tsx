import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSourceInvoiceLink } from "./use-source-invoice-link";

const OWN = "00000000-0000-7000-8000-0000000000b1";
const OTHER = "00000000-0000-7000-8000-0000000000b2";
const state = vi.hoisted(() => ({
  permissions: [] as string[],
  invoices: {} as Record<string, string>,
  calls: [] as string[],
  queries: [] as object[],
}));

vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    finance: {
      listInvoices: async (
        _p: unknown,
        q: { source: string; sourceId: string; encounter?: boolean },
      ) => {
        state.calls.push(`${q.source}:${q.sourceId}`);
        state.queries.push(q);
        const other = q.source === "appointment" ? "visit:v1" : "appointment:a1";
        const id =
          state.invoices[`${q.source}:${q.sourceId}`] ??
          (q.encounter ? state.invoices[other] : undefined);
        return { items: id ? [{ id }] : [], nextCursor: null, total: id ? 1 : 0 };
      },
    },
  }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
  useSession: () => ({
    session: {
      permissions: state.permissions,
      allBranches: false,
      branchIds: [OWN],
      features: { finance: true },
    },
  }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

beforeEach(() => {
  state.invoices = {};
  state.calls = [];
  state.queries = [];
});
afterEach(cleanup);

describe("the source invoice action", () => {
  it.each(["appointment", "visit"] as const)(
    "finds the encounter invoice from %s in ONE request",
    async (kind) => {
      state.permissions = ["view:invoices:clinic", "create:invoices:branch"];
      state.invoices = kind === "appointment" ? { "visit:v1": "inv" } : { "appointment:a1": "inv" };
      const id = kind === "appointment" ? "a1" : "v1";
      const { result } = renderHook(() => useSourceInvoiceLink({ kind, id, branchId: OWN }), {
        wrapper,
      });
      await waitFor(() => expect(result.current).toEqual({ kind: "view", invoiceId: "inv" }));
      expect(state.queries).toEqual([
        { source: kind, sourceId: id, encounter: true, status: "issued", limit: 1 },
      ]);
    },
  );

  it("offers a new invoice in the member's create branch only", async () => {
    state.permissions = ["view:invoices:clinic", "create:invoices:branch"];
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

  it("a create-only role gets «فاتورة» without looking up an invoice it cannot view", () => {
    state.permissions = ["create:invoices:branch"];
    state.invoices = { "visit:v1": "inv" };
    const { result } = renderHook(
      () => useSourceInvoiceLink({ kind: "visit", id: "v1", branchId: OWN }),
      { wrapper },
    );
    expect(result.current).toEqual({ kind: "create", source: "visit", id: "v1" });
    expect(state.calls).toEqual([]);
  });

  it("a view-only role sees the invoice billed on the visit's appointment", async () => {
    state.permissions = ["view:invoices:clinic"];
    state.invoices = { "appointment:a1": "inv" };
    const { result } = renderHook(
      () => useSourceInvoiceLink({ kind: "visit", id: "v1", appointmentId: "a1", branchId: OWN }),
      { wrapper },
    );
    await waitFor(() => expect(result.current).toEqual({ kind: "view", invoiceId: "inv" }));
  });

  it("NEGATIVE: a view-only role with no invoice gets nothing", async () => {
    state.permissions = ["view:invoices:clinic"];
    const { result } = renderHook(
      () => useSourceInvoiceLink({ kind: "visit", id: "v1", branchId: OWN }),
      { wrapper },
    );
    await waitFor(() => expect(state.calls).toEqual(["visit:v1"]));
    expect(result.current).toBeNull();
  });
});
