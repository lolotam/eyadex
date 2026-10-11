import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { renderAs } from "@/shared/persona/persona-test-kit";
import { Icd10Picker } from "./icd10-picker";
import { api, doctorAt } from "./medical-test-kit";

// The picker must call the kit's client: `ApiProvider` builds its own, which a spy could never hold.
vi.mock("@/shared/api/api-provider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/api-provider")>();
  const kit = await import("@/shared/api/mock/mock-test-kit");
  return { ...real, useApi: () => kit.api };
});

beforeEach(() => resetMockData());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function search(q: string) {
  await renderAs(doctorAt(0), <Icd10Picker code="" title="" onPick={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: ar.visit.icdPick }));
  fireEvent.change(await screen.findByLabelText(ar.visit.icdSearch), { target: { value: q } });
}

// Codex 4241757319: a failed search is told apart from a search with no match.
describe("the ICD-10 picker's answer", () => {
  it("a failed search says so with the error, never 'No code matches'", async () => {
    vi.spyOn(api.medical, "searchIcd10").mockRejectedValue(new ApiError("forbidden"));
    await search("F41");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(ar.visit.icdError);
    expect(alert.textContent).toContain(ar.errors.forbidden);
    expect(screen.queryByText(ar.visit.icdNone)).toBeNull();
  });

  it("a search with no match says no code matches", async () => {
    await search("zzzz");
    expect(await screen.findByText(ar.visit.icdNone)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
