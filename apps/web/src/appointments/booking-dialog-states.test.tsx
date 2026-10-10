import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaContext } from "@/shared/persona/persona-context";
import { BookingDialog, type BookingRequest } from "./booking-dialog";

// The real mock client, with the services list and the patient search under the test's control.
const { listServices, listPatients } = vi.hoisted(() => ({
  listServices: vi.fn(),
  listPatients: vi.fn(),
}));
vi.mock("@/shared/api/api-provider", async () => {
  const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
  const client = createMockApiClient();
  const recorded = {
    ...client,
    scheduling: { ...client.scheduling, listServices },
    patients: { ...client.patients, list: listPatients },
  };
  return {
    ApiProvider: ({ children }: { children: ReactNode }) => children,
    useApi: () => recorded,
  };
});

const persona = as("clinic_admin");
// A refusal the queries do not retry, so the failure shows at once.
const down = () => Promise.reject(new ApiError("not_implemented"));

beforeEach(() => {
  resetMockData();
  listServices.mockReset();
  listPatients.mockReset();
  listServices.mockImplementation((...args: Parameters<typeof api.scheduling.listServices>) =>
    api.scheduling.listServices(...args),
  );
  listPatients.mockImplementation((...args: Parameters<typeof api.patients.list>) =>
    api.patients.list(...args),
  );
});
afterEach(() => cleanup());

async function openDialog() {
  const doctor = getState().members.find(
    (m) => m.clinicId === clinicIdAt(0) && m.status === "active" && m.branchIds.length > 0,
  )!;
  const day = await api.appointments.day(persona, {
    branchId: doctor.branchIds[0]!,
    date: "2027-03-07",
  });
  const provider = day.providers.find((p) => p.bookable)!;
  const request: BookingRequest = {
    kind: "create",
    providerId: provider.membershipId,
    startsAt: "2027-03-07T07:00:00.000Z",
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <PersonaContext.Provider value={{ persona, ready: true, setPersona: () => undefined }}>
          <BookingDialog request={request} day={day} onClose={vi.fn()} />
        </PersonaContext.Provider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const saveButton = () => screen.getByRole("button", { name: ar.appointments.dialog.save });

describe("the booking dialog while its lists are missing (Codex PR #64)", () => {
  it("blocks booking until the services list loads, and offers a retry when it fails", async () => {
    listServices.mockImplementation(down);
    await openDialog();
    expect(await screen.findByText(ar.appointments.dialog.servicesFailed)).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", true);
    listServices.mockImplementation((...args: Parameters<typeof api.scheduling.listServices>) =>
      api.scheduling.listServices(...args),
    );
    fireEvent.click(screen.getByRole("button", { name: ar.common.retry }));
    await waitFor(() => expect(saveButton()).toHaveProperty("disabled", false));
    expect(screen.queryByText(ar.appointments.dialog.servicesFailed)).toBeNull();
  });

  it("a failed patient search says so instead of 'no matching file'", async () => {
    listPatients.mockImplementation(down);
    await openDialog();
    fireEvent.change(await screen.findByLabelText(ar.appointments.patientPicker.search), {
      target: { value: "سارة" },
    });
    expect(await screen.findByText(ar.appointments.patientPicker.searchFailed)).toBeTruthy();
    expect(screen.queryByText(ar.appointments.patientPicker.noResults)).toBeNull();
  });
});
