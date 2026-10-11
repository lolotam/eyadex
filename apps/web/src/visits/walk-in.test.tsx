import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { doctorAt, getState } from "./medical-test-kit";
import { renderAs } from "@/shared/persona/persona-test-kit";
import { VisitsPage } from "./visits-page";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => navigate,
}));

beforeEach(() => {
  resetMockData();
  navigate.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Searches the doctor's first branch, picks an active file and presses Start; returns the branch. */
async function startFromSearch(D: Persona, keys?: string[]) {
  await renderAs(D, <VisitsPage />, keys);
  await screen.findByText(ar.visits.walkInTitle);
  const branchId = await waitFor(() => {
    const member = getState().members.find((m) => m.id === D.memberId)!;
    return member.branchIds[0]!;
  });
  const patient = getState().patients.find(
    (p) => p.registrationBranchId === branchId && p.status === "active",
  )!;
  // By name: a one-digit file number is below the two-character minimum.
  fireEvent.change(screen.getByLabelText(ar.visits.search), {
    target: { value: patient.fullName.slice(0, 4) },
  });
  fireEvent.click(screen.getByRole("button", { name: ar.common.search }));
  await screen.findByText(patient.fullName);
  fireEvent.click(screen.getAllByRole("button", { name: new RegExp(ar.visits.start) })[0]!);
  return branchId;
}

describe("the walk-in flow", () => {
  it("searches the branch, picks a file, starts the visit and opens it", async () => {
    const branchId = await startFromSearch(doctorAt(0));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const target = navigate.mock.calls[0]![0] as { params: { visitId: string } };
    const started = getState().medical.visits.find((v) => v.id === target.params.visitId);
    expect(started?.appointmentId).toBeNull();
    expect(started?.branchId).toBe(branchId);
  });

  it("starts but stays, with a toast, for a role that cannot view visits (Codex 4241453967)", async () => {
    const success = vi.spyOn(toast, "success");
    const before = getState().medical.visits.length;
    await startFromSearch(doctorAt(0), ["create:visits:own"]);
    await waitFor(() => expect(success).toHaveBeenCalledWith(ar.visits.startedNoView));
    expect(navigate).not.toHaveBeenCalled();
    expect(getState().medical.visits).toHaveLength(before + 1);
  });

  it("is Forbidden without create:visits:own", async () => {
    await renderAs(doctorAt(0), <VisitsPage />, ["view:visits:own"]);
    expect(screen.getByText(ar.forbidden.title)).toBeInTheDocument();
  });
});
